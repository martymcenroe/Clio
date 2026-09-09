// #347 -- what distinguishes the messages that get lost from the ones that never do?
//
// Block one leaves a fragile subpopulation: 45 messages missed in 3 of 4 runs and
// 77 missed in 2 of 4, against 0.04 and 5.9 expected under independence. They are
// not a random sample of the corpus. This asks what they have in common.
//
// Method: partition the union into ALWAYS (missed by no run) and FRAGILE (missed
// by 2+ runs), then compare their properties. A message's properties are read
// from whichever run captured it -- they are the same message either way.
//
// Every candidate feature here is one the scroll walk could plausibly act on:
// where the message sits in the conversation, how big the conversation is, what
// role it is, how long it is, whether it carries reasoning or attachments.
//
// Prints counts, rates and id prefixes only. Never message content.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { missCountsForConversation } = require('./sweep-stats.js');

const HARVEST = path.join(os.homedir(), 'Projects', 'clio-harvest');
const NAMES = ['sweep-1', 'sweep-2', 'sweep-3', 'sweep-4'];
const say = (s) => process.stdout.write(s + '\n');

// Which conversations succeeded in every run -- the only comparable set.
const okIds = NAMES.map((n) => {
  const ids = new Set();
  for (const line of fs.readFileSync(path.join(HARVEST, n, 'manifest.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.ok) ids.add(r.id); } catch (e) { /* torn line */ }
  }
  return ids;
});
const common = [...okIds[0]].filter((id) => okIds.every((s) => s.has(id)));

const readExport = (sweep, convId) => {
  const f = path.join(HARVEST, sweep, `${convId}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
};

const groups = {
  always: { n: 0, user: 0, assistant: 0, thinking: 0, attach: 0, len: [], relPos: [], convSize: [], roleArr: [], attachArr: [] },
  fragile: { n: 0, user: 0, assistant: 0, thinking: 0, attach: 0, len: [], relPos: [], convSize: [], roleArr: [], attachArr: [] },
};
const fragileByConv = new Map();
let convsWithFragile = 0;

for (const convId of common) {
  const exports_ = NAMES.map((n) => readExport(n, convId));
  if (exports_.some((e) => !e || !Array.isArray(e.messages))) continue;

  const idLists = exports_.map((e) => e.messages.map((m) => m.id).filter(Boolean));
  const m = missCountsForConversation(idLists);

  // Properties, taken from whichever run captured the message. Also record the
  // largest observed message count for the conversation, as the best available
  // stand-in for its true size.
  const convSize = Math.max(...exports_.map((e) => e.messages.length));
  const props = new Map();
  exports_.forEach((e) => {
    e.messages.forEach((msg) => {
      if (!msg.id || props.has(msg.id)) return;
      props.set(msg.id, {
        role: msg.role,
        index: msg.index,
        length: (msg.content || '').length,
        thinking: !!msg.thinking,
        attach: (msg.attachments || []).length,
      });
    });
  });

  let fragileHere = 0;
  for (const [id, who] of m.missedBy) {
    const p = props.get(id);
    if (!p) continue;
    const g = who.length === 0 ? groups.always : (who.length >= 2 ? groups.fragile : null);
    if (!g) continue;                       // missed exactly once: neither group
    g.n += 1;
    if (p.role === 'user') g.user += 1; else if (p.role === 'assistant') g.assistant += 1;
    if (p.thinking) g.thinking += 1;
    if (p.attach > 0) g.attach += 1;
    g.len.push(p.length);
    g.convSize.push(convSize);
    g.roleArr.push(p.role);
    g.attachArr.push(p.attach);
    // 0 = first message in the conversation, 1 = last. The walk climbs from the
    // bottom, so the top is what it reaches last.
    g.relPos.push(convSize > 1 ? (p.index || 0) / (convSize - 1) : 0);
    if (g === groups.fragile) fragileHere += 1;
  }
  if (fragileHere) {
    convsWithFragile += 1;
    fragileByConv.set(convId, { fragile: fragileHere, size: convSize });
  }
}

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : '0.0');

say(`conversations comparable across all ${NAMES.length} runs: ${common.length}`);
say(`ALWAYS captured: ${groups.always.n}    FRAGILE (missed by 2+ runs): ${groups.fragile.n}`);
say('');

say('FEATURE                        always      fragile');
const row = (label, a, f) => say(`  ${label.padEnd(28)} ${String(a).padStart(9)}  ${String(f).padStart(11)}`);
row('user role %', pct(groups.always.user, groups.always.n), pct(groups.fragile.user, groups.fragile.n));
row('assistant role %', pct(groups.always.assistant, groups.always.n), pct(groups.fragile.assistant, groups.fragile.n));
row('carries reasoning %', pct(groups.always.thinking, groups.always.n), pct(groups.fragile.thinking, groups.fragile.n));
row('has attachments %', pct(groups.always.attach, groups.always.n), pct(groups.fragile.attach, groups.fragile.n));
row('median content chars', median(groups.always.len), median(groups.fragile.len));
row('mean content chars', Math.round(mean(groups.always.len)), Math.round(mean(groups.fragile.len)));
row('median conversation size', median(groups.always.convSize), median(groups.fragile.convSize));
row('mean conversation size', Math.round(mean(groups.always.convSize)), Math.round(mean(groups.fragile.convSize)));
row('median position (0=top)', median(groups.always.relPos).toFixed(3), median(groups.fragile.relPos).toFixed(3));
row('mean position (0=top)', mean(groups.always.relPos).toFixed(3), mean(groups.fragile.relPos).toFixed(3));
say('');

// Position is the feature the walk could most plausibly act on, so give it the
// full shape rather than a summary statistic.
say('POSITION IN CONVERSATION  (0 = oldest/top, 1 = newest/bottom)');
say('  decile      always        fragile');
for (let d = 0; d < 10; d++) {
  const lo = d / 10, hi = (d + 1) / 10;
  const inBin = (arr) => arr.filter((x) => x >= lo && (d === 9 ? x <= hi : x < hi)).length;
  const a = inBin(groups.always.relPos);
  const f = inBin(groups.fragile.relPos);
  const bar = '#'.repeat(Math.round(40 * f / Math.max(1, groups.fragile.n)));
  say(`  ${lo.toFixed(1)}-${hi.toFixed(1)}  ${String(a).padStart(8)} (${pct(a, groups.always.n).padStart(5)}%)  ` +
      `${String(f).padStart(4)} (${pct(f, groups.fragile.n).padStart(5)}%) ${bar}`);
}
say('');

say('CONVERSATION SIZE OF FRAGILE MESSAGES');
const sizes = [[0, 10], [10, 50], [50, 100], [100, 200], [200, 1e9]];
for (const [lo, hi] of sizes) {
  const a = groups.always.convSize.filter((s) => s >= lo && s < hi).length;
  const f = groups.fragile.convSize.filter((s) => s >= lo && s < hi).length;
  const label = hi > 1e8 ? `${lo}+` : `${lo}-${hi}`;
  say(`  ${label.padEnd(10)} always ${String(a).padStart(6)} (${pct(a, groups.always.n).padStart(5)}%)   ` +
      `fragile ${String(f).padStart(4)} (${pct(f, groups.fragile.n).padStart(5)}%)`);
}
say('');

// Fragile messages sit overwhelmingly in 10-50 message conversations, and role
// mix varies with conversation size, so the role signal could be riding on that
// rather than being real. Stratify: if user-over-representation survives inside
// each size band, it is not a size artefact.
const { binomTailGE } = require('./sweep-stats.js');
say('ROLE AND ATTACHMENTS, STRATIFIED BY CONVERSATION SIZE');
say('  (does the signal survive inside each band, or is it a size artefact?)');
say('');
say('  band        always: user%  attach%    fragile: n  user%  attach%   p(user)');
for (const [lo, hi] of sizes) {
  const pick = (g) => {
    const idx = g.convSize.map((s, i) => (s >= lo && s < hi ? i : -1)).filter((i) => i >= 0);
    return {
      n: idx.length,
      user: idx.filter((i) => g.roleArr[i] === 'user').length,
      attach: idx.filter((i) => g.attachArr[i] > 0).length,
    };
  };
  const a = pick(groups.always);
  const f = pick(groups.fragile);
  if (!f.n) continue;
  const baseUser = a.n ? a.user / a.n : 0;
  // How surprising is the fragile set's user count, given this band's own baseline?
  const p = baseUser > 0 && f.user > 0 ? binomTailGE(f.n, baseUser, f.user) : 1;
  const label = hi > 1e8 ? `${lo}+` : `${lo}-${hi}`;
  say(`  ${label.padEnd(10)}        ${pct(a.user, a.n).padStart(5)}%  ${pct(a.attach, a.n).padStart(5)}%` +
      `           ${String(f.n).padStart(4)}  ${pct(f.user, f.n).padStart(5)}%  ${pct(f.attach, f.n).padStart(5)}%   ` +
      `${p < 1e-4 ? p.toExponential(1) : p.toFixed(4)}`);
}
say('');

// Whole-corpus significance for the two headline features.
const uAll = binomTailGE(groups.fragile.n, groups.always.user / groups.always.n, groups.fragile.user);
const aAll = binomTailGE(groups.fragile.n, groups.always.attach / groups.always.n, groups.fragile.attach);
say('WHOLE-CORPUS SIGNIFICANCE  (fragile vs the always-captured baseline)');
say(`  user role:       ${groups.fragile.user}/${groups.fragile.n} fragile are user turns vs ` +
    `${pct(groups.always.user, groups.always.n)}% baseline   p = ${uAll < 1e-4 ? uAll.toExponential(1) : uAll.toFixed(4)}`);
say(`  has attachments: ${groups.fragile.attach}/${groups.fragile.n} fragile carry one vs ` +
    `${pct(groups.always.attach, groups.always.n)}% baseline   p = ${aAll < 1e-4 ? aAll.toExponential(1) : aAll.toFixed(4)}`);
say('');

say(`FRAGILE MESSAGES BY CONVERSATION  (${convsWithFragile} conversations affected; first 15)`);
for (const [convId, e] of [...fragileByConv.entries()].sort((a, b) => b[1].fragile - a[1].fragile).slice(0, 15)) {
  say(`  ${convId.slice(0, 8)}  ${String(e.fragile).padStart(3)} fragile of ${String(e.size).padStart(4)} messages ` +
      `(${pct(e.fragile, e.size).padStart(5)}%)`);
}
