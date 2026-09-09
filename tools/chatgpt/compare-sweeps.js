// Compare sweeps of the whole account and say whether the loss is a race or a
// structural miss (#302).
//
//   node tools/chatgpt/compare-sweeps.js sweep-1 sweep-2 sweep-3
//   node tools/chatgpt/compare-sweeps.js --out <harvest> sweep-a sweep-b
//
// Reads the manifest each sweep wrote; the full exports are only opened if a
// manifest is missing message ids.
//
// WHAT THIS MEASURES, AND WHAT IT CANNOT (#348). For each conversation, take the
// union of message ids seen across the runs, and per message count how many runs
// MISSED it.
//
// The union is built from these runs' own id sets. Every id in it was
// contributed by some run, so no id can be missing from all R runs: the
// all-missed bucket is UNREACHABLE, not merely usually empty. This tool was
// originally documented here as separating a race from a systematic loss. It
// cannot. The systematic side of that split is invisible to any union-based
// method by construction, and the tool printed "the loss is entirely a race" for
// every dataset it ever saw as a result.
//
// What IS measurable is the SHAPE of the loss among messages at least one run
// captured:
//
//   missed in 0 runs        captured every time
//   missed in 1..R-1 runs   the observable range
//   missed in ALL R runs    unreachable; see above
//
// Under an independent race, the number of runs missing a given message follows
// a Poisson binomial over the per-run rates. Correlated loss -- a subpopulation
// that is fragile for every run -- shows up as too few messages missed once and
// too many missed twice or more. That is the verdict this tool now makes, and on
// the block-one sweeps it refutes independence decisively (#347).
//
// To detect messages the extractor never captures at all, use an instrument that
// does not consult a union: audit-drops.js (messagesLoaded - messageCount, #332)
// or the provider's own export (#307).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { assessBuckets, missCountsForConversation } = require('./sweep-stats.js');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : (process.argv[i + 1] || dflt);
}
const HARVEST = arg('out', path.join(os.homedir(), 'Projects', 'clio-harvest'));
const names = process.argv.slice(2).filter(a => !a.startsWith('--') &&
  process.argv[process.argv.indexOf(a) - 1] !== '--out');

if (names.length < 2) {
  console.log('usage: compare-sweeps.js <sweep-dir> <sweep-dir> [more...]');
  process.exit(2);
}

const say = (s) => process.stdout.write(s + '\n');
// Small p-values are the whole point here, so they must not round to 0.000.
const fmtP = (p) => (p < 1e-4 ? p.toExponential(1) : p.toFixed(4));

function loadSweep(name) {
  const dir = path.isAbsolute(name) ? name : path.join(HARVEST, name);
  const manifest = path.join(dir, 'manifest.jsonl');
  if (!fs.existsSync(manifest)) {
    say(`no manifest in ${dir}`);
    process.exit(2);
  }
  const byConv = new Map();
  let failures = 0;
  for (const line of fs.readFileSync(manifest, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch (e) { continue; }
    if (!row.ok) { failures++; continue; }
    let ids = row.messageIds;
    if (!ids) {
      // An older manifest; fall back to the export itself.
      const f = path.join(dir, `${row.id}.json`);
      if (fs.existsSync(f)) {
        ids = JSON.parse(fs.readFileSync(f, 'utf8')).messages.map(m => m.id);
      }
    }
    byConv.set(row.id, { ...row, ids: (ids || []).filter(Boolean) });
  }
  return { name: path.basename(dir), dir, byConv, failures };
}

const runs = names.map(loadSweep);
const R = runs.length;

say('SWEEPS');
for (const r of runs) {
  const msgs = [...r.byConv.values()].reduce((a, c) => a + c.ids.length, 0);
  say(`  ${r.name.padEnd(14)} ${String(r.byConv.size).padStart(4)} conversations  ` +
      `${String(msgs).padStart(6)} messages  ${r.failures} failure(s)`);
}
say('');

// Only conversations captured in EVERY run can be compared. A conversation
// missing from one run says nothing about per-message loss, and including it
// would count its whole content as "missed".
const common = [...runs[0].byConv.keys()].filter(id => runs.every(r => r.byConv.has(id)));
say(`conversations captured in all ${R} runs: ${common.length}`);
if (!common.length) { say('nothing comparable'); process.exit(1); }
say('');

let unionTotal = 0;
const missBuckets = new Array(R + 1).fill(0);
const perRunMissed = new Array(R).fill(0);
const alwaysMissed = [];
const unstable = [];

for (const convId of common) {
  const m = missCountsForConversation(runs.map(r => r.byConv.get(convId).ids));
  unionTotal += m.unionSize;
  for (let k = 0; k <= R; k++) missBuckets[k] += m.buckets[k];
  for (let i = 0; i < R; i++) perRunMissed[i] += m.perRun[i];

  let convAlways = 0, convRacy = 0;
  for (const [id, who] of m.missedBy) {
    // `who.length === R` is unreachable -- see missCountsForConversation. Kept
    // so the shape of the old accounting is still legible, and so a future
    // change that makes the union a true superset lights this up rather than
    // silently doing nothing.
    if (who.length === R) { convAlways++; alwaysMissed.push({ convId, id }); }
    else if (who.length > 0) convRacy++;
  }

  const counts = runs.map(r => r.byConv.get(convId).ids.length);
  const spread = Math.max(...counts) - Math.min(...counts);
  if (spread > 0 || convAlways > 0) {
    unstable.push({ convId, counts, union: m.unionSize, always: convAlways, racy: convRacy, spread });
  }
}

say('PER-RUN CAPTURE');
runs.forEach((r, i) => {
  const rate = 100 * (1 - perRunMissed[i] / unionTotal);
  say(`  ${r.name.padEnd(14)} missed ${String(perRunMissed[i]).padStart(5)} of ${unionTotal}` +
      `   captured ${rate.toFixed(2)}%`);
});
const pHat = perRunMissed.reduce((a, b) => a + b, 0) / (unionTotal * R);
say(`  pooled per-message miss rate p = ${(100 * pHat).toFixed(3)}%`);
say('');

const assessment = assessBuckets({ perRunMissed, unionTotal, missBuckets });

say('MISS-COUNT DISTRIBUTION  (across the union of all runs)');
for (let k = 0; k <= R; k++) {
  if (k === R) {
    // Not an observation. The union is built from these runs' own id sets, so
    // every id in it was contributed by some run and no id can be missing from
    // all of them. Printing a bare 0 here read as "nothing systematic was
    // found", which is the misreading that stood for the life of this tool
    // (#348).
    say(`  missed ${k}x: ${'--'.padStart(6)}   UNREACHABLE -- the union is built from these runs,`);
    say(`  ${''.padEnd(11)}   so a message missed by all of them is in no run's id list and`);
    say(`  ${''.padEnd(11)}   never reaches this table. See READING IT below.`);
    continue;
  }
  const expected = k === 0
    ? unionTotal * (assessment.buckets.reduce((a, b) => a - b.prob, 1))
    : assessment.buckets.find((b) => b.k === k).expected;
  const label = k === 0 ? 'captured every time' : `missed in ${k} of ${R}`;
  const exp = expected < 0.05 ? expected.toExponential(1) : expected.toFixed(1);
  const ratio = expected > 0 ? (missBuckets[k] / expected) : Infinity;
  const ratioStr = missBuckets[k] === 0 ? '' : `   obs/exp ${ratio.toFixed(ratio >= 100 ? 0 : 2)}x`;
  const b = assessment.buckets.find((x) => x.k === k);
  const sig = b && b.significant ? `  p = ${fmtP(b.pValue)}  ${b.direction.toUpperCase()}` : '';
  say(`  missed ${k}x: ${String(missBuckets[k]).padStart(6)}   ` +
      `expected if independent ${exp.padStart(8)}   ${label}${ratioStr}${sig}`);
}
say('');
say('  Expectations use each run\'s OWN miss rate, not a pooled one, and are');
say('  conditioned on the message being in the union at all -- which is what the');
say('  observed counts are conditioned on.');
say('');

say('READING IT');
if (assessment.independent) {
  say('  The miss-count shape is consistent with an independent race: a message');
  say('  missed by one run is no likelier than chance to be missed by another.');
  say('  Capturing twice and merging by id would recover most of this.');
} else {
  const worst = [...assessment.excesses].sort((a, b) => b.ratio - a.ratio)[0];
  say('  The loss is NOT an independent race. Misses are CORRELATED across runs:');
  if (worst) {
    say(`  ${worst.observed} message(s) were missed in ${worst.k} of ${R} runs against ` +
        `${worst.expected < 0.05 ? worst.expected.toExponential(1) : worst.expected.toFixed(1)} expected`);
    say(`  under independence -- ${worst.ratio >= 100 ? worst.ratio.toFixed(0) : worst.ratio.toFixed(1)}x, ` +
        `p = ${fmtP(worst.pValue)}.`);
  }
  for (const d of assessment.deficits) {
    say(`  And only ${d.observed} missed in ${d.k} of ${R} against ${d.expected.toFixed(1)} expected ` +
        `(${d.ratio.toFixed(2)}x, p = ${fmtP(d.pValue)}) --`);
    say('  the mirror image of the same thing.');
  }
  say('');
  say('  That means a subpopulation of messages is fragile for every run rather');
  say('  than each run losing a random sample. Capturing twice and merging helps');
  say('  much less than the pooled rate suggests, because the residue is exactly');
  say('  the fragile set. See #347.');
}
say('');
say('  What NO union-based test can see: a message the extractor removes in every');
say('  run is in no run\'s id list, so it never reaches the table above -- that is');
say('  why the all-missed row is unreachable rather than merely empty. Detecting');
say('  that class needs an instrument that does not consult a union:');
say('  audit-drops.js (messagesLoaded - messageCount, #332), which measures 15');
say('  such messages across these sweeps, or the provider export (#307).');
say('');

if (alwaysMissed.length) {
  say(`ALWAYS MISSED  (${alwaysMissed.length}; first 25)`);
  for (const m of alwaysMissed.slice(0, 25)) {
    say(`  conversation ${m.convId.slice(0, 8)}  message ${m.id}`);
  }
  say('');
}

say('LEAST STABLE CONVERSATIONS  (by capture-count spread; first 15)');
unstable.sort((a, b) => b.spread - a.spread || b.always - a.always);
for (const u of unstable.slice(0, 15)) {
  say(`  ${u.convId.slice(0, 8)}  counts ${u.counts.join('/')}  union ${u.union}` +
      `  spread ${u.spread}  race ${u.racy}  always-missed ${u.always}`);
}
