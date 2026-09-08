// Find messages the extractor dropped, from sweeps already on disk (#332).
//
//   node tools/chatgpt/audit-drops.js sweep-1 sweep-2 sweep-3
//   node tools/chatgpt/audit-drops.js --out <harvest> sweep-1
//
// WHY THIS EXISTS, AND WHY IT IS NOT compare-sweeps.js. That script compares
// runs against each other, so it can only see a message that at least one run
// captured. A message the extractor removes identically every time never enters
// any run's id list, is in no run's union, and therefore cannot appear in its
// miss-count distribution at all. It is invisible to the comparison by
// construction -- not rare, invisible. This finds exactly that class.
//
// THE TWO TERMS.
//
//   d = scrollInfo.messagesLoaded - metadata.messageCount
//
// How many turns the extractor saw arrive in the DOM and then did not export.
// It is a COUNT of losses and it is exact, but it says nothing about where.
//
//   S = { i : 1 <= i <= n-1, role[i] == role[i-1] }
//
// Adjacent same-role turns in the export. In an alternating conversation that is
// the hole a removed turn leaves behind. On its own S is only suggestive --
// consecutive assistant turns do occur legitimately -- but with d the search is
// bounded:
//
//   d == 0        nothing was removed; every element of S is legitimate
//   d == |S|      every candidate is a true positive; drops fully localised
//   0 < d < |S|   |S| places to look for d losses; precision d/|S|
//
// KNOWN LIMITATION, and it must travel with any report of this. The rule cannot
// see a drop between same-role neighbours: if the true sequence was A A A and
// the middle turn is lost, the result is A A, which was already an adjacency. So
// S under-reports, and the false negatives are exactly the drops landing inside
// an existing same-role run. d is unaffected by this and remains exact.

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Indices i where role[i] === role[i-1]. These are the candidate drop sites.
 * @param {Array<{role: string}>} messages
 * @returns {number[]}
 */
function adjacencySites(messages) {
  const out = [];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role && messages[i].role === messages[i - 1].role) out.push(i);
  }
  return out;
}

/**
 * Read one conversation into the two terms.
 * @returns {{id, loaded, exported, d, sites, precision}|null}
 */
function auditConversation(id, exportJson) {
  const meta = exportJson && exportJson.metadata;
  const messages = (exportJson && exportJson.messages) || [];
  if (!meta) return null;
  const loaded = meta.scrollInfo && typeof meta.scrollInfo.messagesLoaded === 'number'
    ? meta.scrollInfo.messagesLoaded : null;
  const exported = typeof meta.messageCount === 'number' ? meta.messageCount : messages.length;
  if (loaded === null) return null;
  const sites = adjacencySites(messages);
  const d = loaded - exported;
  return {
    id,
    loaded,
    exported,
    d,
    sites,
    // Undefined rather than 0 when there is nothing to localise: a precision of
    // "0/0" is not 0, it is not a question.
    precision: d > 0 && sites.length ? d / sites.length : null,
  };
}

function main() {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? dflt : (process.argv[i + 1] || dflt);
  };
  const HARVEST = arg('out', path.join(os.homedir(), 'Projects', 'clio-harvest'));
  const names = process.argv.slice(2).filter((a) => !a.startsWith('--') &&
    process.argv[process.argv.indexOf(a) - 1] !== '--out');

  if (!names.length) {
    console.log('usage: audit-drops.js <sweep-dir> [more...]');
    process.exit(2);
  }

  const say = (s) => process.stdout.write(s + '\n');
  const sweeps = [];

  for (const name of names) {
    const dir = path.isAbsolute(name) ? name : path.join(HARVEST, name);
    const manifest = path.join(dir, 'manifest.jsonl');
    if (!fs.existsSync(manifest)) {
      say(`no manifest in ${dir}`);
      process.exit(2);
    }
    const rows = [];
    let failures = 0;
    let unreadable = 0;
    for (const line of fs.readFileSync(manifest, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch (e) { continue; }
      if (!row.ok) { failures++; continue; }
      const file = path.join(dir, `${row.id}.json`);
      if (!fs.existsSync(file)) { unreadable++; continue; }
      let j;
      try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { unreadable++; continue; }
      const a = auditConversation(row.id, j);
      if (a) rows.push(a); else unreadable++;
    }
    sweeps.push({ name, rows, failures, unreadable });
  }

  say('DROPPED MESSAGES  (loaded minus exported, per sweep)');
  for (const s of sweeps) {
    const loaded = s.rows.reduce((a, r) => a + r.loaded, 0);
    const exported = s.rows.reduce((a, r) => a + r.exported, 0);
    const dropped = s.rows.filter((r) => r.d > 0);
    const negative = s.rows.filter((r) => r.d < 0);
    const total = dropped.reduce((a, r) => a + r.d, 0);
    const pct = s.rows.length ? (100 * dropped.length / s.rows.length).toFixed(1) : '0.0';
    say(`  ${s.name.padEnd(14)} ${String(s.rows.length).padStart(4)} conversations  ` +
        `${String(loaded).padStart(6)} loaded  ${String(exported).padStart(6)} exported  ` +
        `${String(total).padStart(4)} DROPPED  in ${dropped.length} conversation(s) (${pct}%)`);
    if (s.failures) say(`  ${''.padEnd(14)} ${s.failures} capture failure(s) skipped`);
    if (s.unreadable) say(`  ${''.padEnd(14)} ${s.unreadable} export(s) missing or unreadable`);
    if (negative.length) {
      say(`  ${''.padEnd(14)} ${negative.length} conversation(s) exported MORE than loaded -- ` +
          'not a drop, and not expected; investigate separately');
    }
  }
  say('');

  for (const s of sweeps) {
    const dropped = s.rows.filter((r) => r.d > 0).sort((a, b) => b.d - a.d);
    if (!dropped.length) continue;
    say(`WORST IN ${s.name}  (first 10)`);
    for (const r of dropped.slice(0, 10)) {
      const loc = r.sites.length === 0
        ? 'no same-role adjacency -- the drop is inside an existing same-role run (invisible to S)'
        : r.d === r.sites.length
          ? `fully localised: ${r.sites.length} candidate(s), all true positives`
          : `${r.sites.length} candidate(s) for ${r.d} loss(es), precision ${(100 * r.precision).toFixed(0)}%`;
      say(`  ${r.id.slice(0, 8)}  ${String(r.d).padStart(3)}/${String(r.loaded).padStart(4)} lost   ${loc}`);
    }
    say('');
  }

  if (sweeps.length > 1) {
    say('IS THE LOSS DETERMINISTIC?  (conversations present in every sweep)');
    const common = sweeps[0].rows
      .map((r) => r.id)
      .filter((id) => sweeps.every((s) => s.rows.some((r) => r.id === id)));
    const byId = sweeps.map((s) => new Map(s.rows.map((r) => [r.id, r])));

    let identical = 0;
    let varying = 0;
    const everDropped = [];
    for (const id of common) {
      const ds = byId.map((m) => m.get(id).d);
      if (ds.every((d) => d === 0)) continue;
      everDropped.push({ id, ds });
      if (ds.every((d) => d === ds[0])) identical++; else varying++;
    }
    say(`  ${common.length} conversation(s) in all ${sweeps.length} sweeps; ` +
        `${everDropped.length} dropped at least once`);
    say(`  ${identical} lost the SAME count every run  ->  deterministic, not a race`);
    say(`  ${varying} lost a varying count            ->  race, or a mix`);
    if (everDropped.length) {
      say('');
      say('  per conversation (first 15):');
      for (const e of everDropped.slice(0, 15)) {
        const same = e.ds.every((d) => d === e.ds[0]) ? '  same every run' : '';
        say(`    ${e.id.slice(0, 8)}  ${e.ds.join(' / ')}${same}`);
      }
    }
    say('');
  }

  say('READING IT');
  say('  d is exact: it counts turns that arrived in the DOM and were not');
  say('  exported. S only localises them, and it cannot see a drop that lands');
  say('  between two turns of the same role -- those are its false negatives.');
  say('  A conversation with d > 0 and no candidate sites is that case, not a');
  say('  contradiction.');
  say('');
  say('  None of this is visible to compare-sweeps.js: a message dropped in');
  say('  every run never enters any run\'s id list, so it is in no union and no');
  say('  miss-count bucket.');
}

if (require.main === module) main();

module.exports = { adjacencySites, auditConversation };
