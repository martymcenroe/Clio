// Compare several census runs of one conversation (#291).
//
//   node tools/chatgpt/compare-censuses.js <census.json> <census.json> ...
//
// One run says what a capture got. Several runs say what a capture MISSES,
// because the union across runs is the best available lower bound on what the
// conversation actually holds — and no single run has been a superset of the
// others yet.
//
// Answers three questions, in order of what they'd change:
//
//   WHO   which messages each run missed, by id
//   WHERE where those sit in the conversation, via the ordering key, so a lost
//         stretch is visible as a region rather than a list
//   WHEN  what the arrival latency looked like around them — the test of
//         "the loop quits before slow content lands"

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (files.length < 2) { console.log('usage: compare-censuses.js <census.json> ...'); process.exit(2); }

const say = (s) => process.stdout.write(s + '\n');

const runs = files.map((f) => {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const byId = new Map();
  for (const c of d.cache) if (c.id) byId.set(c.id, c);
  return { name: d.run || path.basename(path.dirname(f)), d, byId };
});

say('CAPTURE COUNTS');
for (const r of runs) {
  const rr = r.d.result;
  say(`  ${r.name.padEnd(12)} ${String(r.byId.size).padStart(4)} messages   ` +
      `${String(rr.scrollAttempts).padStart(3)} attempts   ` +
      `reachedTop=${rr.reachedTop}  height=${rr.finalScrollHeight}`);
}

const union = new Map();
for (const r of runs) for (const [id, c] of r.byId) if (!union.has(id)) union.set(id, c);
say('');
say(`UNION ACROSS RUNS: ${union.size} distinct messages`);
say('  (the best available lower bound on the conversation; no run was a superset)');
say('');

say('WHAT EACH RUN MISSED');
for (const r of runs) {
  const missing = [...union.keys()].filter(id => !r.byId.has(id));
  say(`  ${r.name.padEnd(12)} missed ${String(missing.length).padStart(3)} of ${union.size}` +
      `   (${(100 * missing.length / union.size).toFixed(1)}%)`);
}
say('');

// Order the union by the ordering key. Larger key = further from the bottom =
// earlier in the conversation, so descending puts it in reading order.
const ordered = [...union.values()]
  .filter(c => typeof c.fromBottom === 'number')
  .sort((a, b) => b.fromBottom - a.fromBottom);
const pos = new Map(ordered.map((c, i) => [c.id, i]));

say('WHERE THE MISSES SIT  (position in the union, 0 = oldest message)');
say('  each column is 1/60th of the conversation; a digit is how many runs missed there');
const W = 60;
const grid = new Array(W).fill(0);
const perRunGrid = runs.map(() => new Array(W).fill(0));
runs.forEach((r, ri) => {
  for (const id of union.keys()) {
    if (r.byId.has(id)) continue;
    const p = pos.get(id);
    if (p === undefined) continue;
    const col = Math.min(W - 1, Math.floor((p / ordered.length) * W));
    grid[col]++;
    perRunGrid[ri][col]++;
  }
});
say(`  oldest ${'-'.repeat(W - 14)} newest`);
say(`  ${grid.map(n => (n === 0 ? '.' : n > 9 ? '#' : String(n))).join('')}`);
runs.forEach((r, ri) => {
  say(`  ${perRunGrid[ri].map(n => (n === 0 ? '.' : n > 9 ? '#' : String(n))).join('')}  ${r.name}`);
});
say('');

// Are the misses clustered? A contiguous run of missed positions means a
// stretch of conversation never loaded; scattered singletons mean something
// races per message.
for (const r of runs) {
  const missPos = [...union.keys()].filter(id => !r.byId.has(id))
    .map(id => pos.get(id)).filter(p => p !== undefined).sort((a, b) => a - b);
  let best = 0, cur = 0;
  for (let i = 0; i < missPos.length; i++) {
    cur = (i > 0 && missPos[i] === missPos[i - 1] + 1) ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  const roles = {};
  for (const id of union.keys()) {
    if (r.byId.has(id)) continue;
    const role = union.get(id).role || '?';
    roles[role] = (roles[role] || 0) + 1;
  }
  say(`  ${r.name.padEnd(12)} longest contiguous miss: ${best}   by role: ${JSON.stringify(roles)}`);
}
say('');

say('ARRIVAL LATENCY PER RUN  (gaps between successive new messages)');
for (const r of runs) {
  const s = r.d.samples;
  const gaps = [];
  let lastT = 0, lastCache = s.length ? s[0].cache : 0;
  for (const x of s) {
    if (x.cache > lastCache) { gaps.push(x.t - lastT); lastT = x.t; lastCache = x.cache; }
  }
  gaps.sort((a, b) => a - b);
  const q = (p) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0;
  say(`  ${r.name.padEnd(12)} events ${String(gaps.length).padStart(3)}   ` +
      `median ${String(q(0.5)).padStart(5)}ms   p90 ${String(q(0.9)).padStart(6)}ms   ` +
      `max ${String(gaps[gaps.length - 1] || 0).padStart(6)}ms`);
}
say('');
say('READING IT');
say('  A long contiguous miss in one run and not another means that stretch never');
say('  loaded there -- a patience problem, and waiting longer is the fix.');
say('  Scattered single misses at similar latency in every run mean something');
say('  races per message, and more patience will not help.');
