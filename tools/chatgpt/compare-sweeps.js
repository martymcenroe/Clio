// Compare sweeps of the whole account and say whether the loss is a race or a
// structural miss (#302).
//
//   node tools/chatgpt/compare-sweeps.js sweep-1 sweep-2 sweep-3
//   node tools/chatgpt/compare-sweeps.js --out <harvest> sweep-a sweep-b
//
// Reads the manifest each sweep wrote; the full exports are only opened if a
// manifest is missing message ids.
//
// THE DISCRIMINATOR. For each conversation, take the union of message ids seen
// across the runs -- the best available lower bound on what it holds, since no
// single capture has yet been a superset. Then, per message, count how many runs
// MISSED it:
//
//   missed in 0 runs        captured every time
//   missed in 1..R-1 runs   a race; retrying and merging is a valid mitigation
//   missed in ALL R runs    systematic; retrying will never help, and these are
//                           a different bug wearing the same symptom
//
// One run cannot produce that split and two are ambiguous for anything missed
// once, which is why the sweep is run three times.
//
// Under an independent per-message loss model with rate p, miss counts follow
// Binomial(R, p). The expected count in the all-missed bucket is printed beside
// the observed one: a large excess there is the signature of a structural cause
// hiding inside what looks like noise.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { assessAllMissed } = require('./sweep-stats.js');

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
  const sets = runs.map(r => new Set(r.byConv.get(convId).ids));
  const union = new Set();
  for (const s of sets) for (const id of s) union.add(id);
  unionTotal += union.size;

  let convAlways = 0, convRacy = 0;
  for (const id of union) {
    let missed = 0;
    sets.forEach((s, i) => { if (!s.has(id)) { missed++; perRunMissed[i]++; } });
    missBuckets[missed]++;
    if (missed === R) { convAlways++; alwaysMissed.push({ convId, id }); }
    else if (missed > 0) convRacy++;
  }

  const counts = runs.map(r => r.byConv.get(convId).ids.length);
  const spread = Math.max(...counts) - Math.min(...counts);
  if (spread > 0 || convAlways > 0) {
    unstable.push({ convId, counts, union: union.size, always: convAlways, racy: convRacy, spread });
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

say('MISS-COUNT DISTRIBUTION  (across the union of all runs)');
const choose = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
for (let k = 0; k <= R; k++) {
  const expected = unionTotal * choose(R, k) * Math.pow(pHat, k) * Math.pow(1 - pHat, R - k);
  const label = k === 0 ? 'captured every time'
    : k === R ? 'MISSED EVERY TIME -> systematic'
      : `missed in ${k} of ${R} -> race`;
  // toFixed(1) prints the all-missed expectation as "0.0", which is the one
  // number the verdict below actually turns on -- it is ~1.6e-3, not zero.
  const exp = expected < 0.05 ? expected.toExponential(1) : expected.toFixed(1);
  const ratio = expected > 0 ? (missBuckets[k] / expected) : Infinity;
  const ratioStr = missBuckets[k] === 0 ? '' : `   obs/exp ${ratio.toFixed(ratio >= 100 ? 0 : 2)}x`;
  say(`  missed ${k}x: ${String(missBuckets[k]).padStart(6)}   ` +
      `expected if purely random ${exp.padStart(8)}   ${label}${ratioStr}`);
}
say('');
say('  p is fitted from these same runs, so the 0x and single-miss buckets are');
say('  close to expectation partly by construction. The all-missed bucket is the');
say('  one the fit does not pin down, which is why it carries the test below.');
say('');

const verdict = assessAllMissed({ unionTotal, pHat, R, observed: missBuckets[R] });
say('READING IT');
if (missBuckets[R] === 0) {
  say('  Nothing was missed in every run: the loss is entirely a race.');
  say('  Capturing twice and merging by id would recover it.');
} else if (verdict.structural) {
  say(`  ${missBuckets[R]} message(s) were missed in EVERY run against ${verdict.expected.toExponential(2)}`);
  say(`  expected under a pure race -- ${verdict.ratio.toFixed(0)}x expectation, p = ${fmtP(verdict.pValue)}.`);
  say('  That is a second, structural bug: those messages are never captured and');
  say('  no amount of retrying will get them. Inspect them individually; they are');
  say('  listed below.');
} else {
  say(`  ${missBuckets[R]} message(s) were missed in every run against ${verdict.expected.toExponential(2)}`);
  say(`  expected under a pure race, p = ${fmtP(verdict.pValue)}, which does not clear`);
  say(`  alpha = ${verdict.alpha}. No evidence of a structural miss on top of the race.`);
}
say('');
say('  What that verdict cannot see: it reads only messages that reached the');
say('  union. A message the extractor removes identically in EVERY run never');
say('  enters any run\'s id list, so it is in no bucket and cannot appear above at');
say('  all -- see #332, where 18 such messages were measured in sweep-1 while this');
say('  comparison reported an empty all-missed bucket. The test answers "is the');
say('  observed all-missed count consistent with a race", not "was anything lost');
say('  deterministically".');
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
