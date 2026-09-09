// #315 -- is "complete on arrival" something we know, or something we assume?
//
// The COST is a count: short conversations pay the full 45s patience floor, and
// that is ~80 minutes per sweep. The issue is explicit that everything after
// that number is inference, and that "it has not grown, so it is done" is the
// same false-completeness shape that was already wrong twice (#278 offset zero,
// #300 patience calibrated to the luckiest run so far).
//
// So this does not look for evidence that the optimisation is safe. It looks for
// the counter-example, using the one thing the earlier analyses did not have:
// FOUR independent captures of the same 340 conversations. If a conversation ever
// finished small in one run and large in another, then "small" is not "done" and
// the premise dies with data already on disk.
//
// Prints ids and counts only.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HARVEST = path.join(os.homedir(), 'Projects', 'clio-harvest');
const NAMES = ['sweep-1', 'sweep-2', 'sweep-3', 'sweep-4'];
const SMALL = 5;                        // "short conversation" per the issue
const say = (s) => process.stdout.write(s + '\n');

const rows = new Map();                 // convId -> array of per-run rows
for (const name of NAMES) {
  for (const line of fs.readFileSync(path.join(HARVEST, name, 'manifest.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch (e) { continue; }
    if (!r.ok) continue;
    if (!rows.has(r.id)) rows.set(r.id, []);
    rows.get(r.id).push({ sweep: name, ...r, si: r.scrollInfo || {} });
  }
}

const complete = [...rows.entries()].filter(([, rs]) => rs.length === NAMES.length);
say(`conversations captured successfully in all ${NAMES.length} runs: ${complete.length}`);
say('');

// ---- The counter-example test -------------------------------------------
const disagreements = [];
for (const [convId, rs] of complete) {
  const counts = rs.map((r) => r.messageCount);
  const min = Math.min(...counts), max = Math.max(...counts);
  if (min <= SMALL && max > SMALL) disagreements.push({ convId, counts, min, max });
}

say(`THE COUNTER-EXAMPLE TEST: did any conversation finish <= ${SMALL} in one run and larger in another?`);
if (!disagreements.length) {
  say(`  None of ${complete.length}. Across 4 independent captures, no conversation that`);
  say(`  finished at <= ${SMALL} messages ever finished larger in a different run.`);
  say('  That does not prove "small = done" -- it is absence of counter-evidence,');
  say('  not evidence -- but the obvious way for the premise to be false did not');
  say('  happen in 4 x 340 captures.');
} else {
  say(`  ${disagreements.length} conversation(s) DID. The premise is falsified:`);
  for (const d of disagreements.slice(0, 20)) {
    say(`    ${d.convId.slice(0, 8)}  counts ${d.counts.join('/')}  (min ${d.min}, max ${d.max})`);
  }
}
say('');

// A weaker, broader version: any disagreement at all among small conversations.
const smallish = complete.filter(([, rs]) => Math.min(...rs.map((r) => r.messageCount)) <= SMALL);
const smallDisagree = smallish.filter(([, rs]) => new Set(rs.map((r) => r.messageCount)).size > 1);
say(`  Of ${smallish.length} conversations that finished <= ${SMALL} in at least one run,`);
say(`  ${smallDisagree.length} disagreed on the count across runs at all.`);
for (const [convId, rs] of smallDisagree.slice(0, 10)) {
  say(`    ${convId.slice(0, 8)}  counts ${rs.map((r) => r.messageCount).join('/')}`);
}
say('');

// ---- What patience would actually have been needed ----------------------
const gaps = [];
for (const [, rs] of complete) for (const r of rs) {
  if (typeof r.si.longestArrivalGapMs === 'number') gaps.push(r.si.longestArrivalGapMs);
}
gaps.sort((a, b) => a - b);
const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
say('LONGEST ARRIVAL GAP, over every conversation-capture');
say(`  n = ${gaps.length}   median ${q(0.5)}ms   p90 ${q(0.90)}ms   p99 ${q(0.99)}ms   ` +
    `p99.9 ${q(0.999)}ms   max ${gaps[gaps.length - 1]}ms`);
say(`  The configured floor is 45000ms. ` +
    `${gaps.filter((g) => g > 45000).length} capture(s) saw a gap longer than it.`);
say('');

// Same, restricted to the conversations the optimisation would target.
const smallRuns = [];
for (const [, rs] of complete) {
  if (Math.max(...rs.map((r) => r.messageCount)) > SMALL) continue;
  for (const r of rs) if (typeof r.si.longestArrivalGapMs === 'number') smallRuns.push(r);
}
const smallGaps = smallRuns.map((r) => r.si.longestArrivalGapMs).sort((a, b) => a - b);
say(`CONVERSATIONS THAT FINISHED <= ${SMALL} IN EVERY RUN  (what the optimisation would skip)`);
if (smallGaps.length) {
  say(`  ${smallRuns.length} capture(s) across ${smallRuns.length / NAMES.length} conversation(s)`);
  say(`  longest arrival gap: median ${smallGaps[Math.floor(smallGaps.length / 2)]}ms   ` +
      `max ${smallGaps[smallGaps.length - 1]}ms`);
  const elapsed = smallRuns.reduce((a, r) => a + (r.elapsedMs || 0), 0);
  say(`  total elapsed in this class: ${(elapsed / 60000).toFixed(0)} min across ${NAMES.length} runs ` +
      `(${(elapsed / 60000 / NAMES.length).toFixed(0)} min per run)`);
  const reached = smallRuns.filter((r) => r.si.reachedTop).length;
  say(`  reachedTop: ${reached}/${smallRuns.length}`);
  const terms = {};
  for (const r of smallRuns) terms[r.si.terminationReason] = (terms[r.si.terminationReason] || 0) + 1;
  say(`  termination reasons: ${Object.entries(terms).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
say('');

say('READING IT');
say('  The cost is real and is a count. The safety of skipping it is NOT');
say('  established by this: no counter-example in 1360 captures bounds the risk,');
say('  it does not eliminate it, and #300 is the precedent -- patience calibrated');
say('  to the luckiest run so far stopped 110,000px short.');
say('  What WOULD settle it is the provider export (#307): the true message count');
say('  per conversation, independent of anything the walk observed.');
