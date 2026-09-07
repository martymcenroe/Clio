// Compare two captures of the same conversation, by message id (#294).
//
//   node tools/chatgpt/diff-exports.js <a.json> <b.json> [...more]
//
// This is the acceptance test named on #278, made runnable: "a correct
// extraction is a superset of the three existing captures". With ids that is a
// set difference. Without them it had to be attempted on message text, and two
// comparators gave two different answers — 130 missing on exact text, 44 on a
// normalised prefix — because the harvester takes el.innerText while the
// extension runs extractTextContent(). Neither number was authoritative, on the
// question that decides whether the tool works.
//
// Reads both this repo's formats: the extension's export (`content`, and `id`
// since #294) and tools/chatgpt/harvest.js output (`text`, `id`).
//
// The LAST file given is the candidate; every earlier file is a reference it
// must contain. Exit 0 when the candidate is a superset of all of them.
//
// Prints ids and counts. No message text is printed beyond a short head, since
// these files are operator conversation content.

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (files.length < 2) {
  console.log('usage: diff-exports.js <reference.json> [more-references...] <candidate.json>');
  process.exit(2);
}

const say = (s) => process.stdout.write(s + '\n');

function load(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const msgs = data.messages || [];
  const byId = new Map();
  let missingId = 0;
  for (const m of msgs) {
    const text = m.content || m.text || '';
    if (!m.id) { missingId++; continue; }
    byId.set(m.id, { role: m.role, chars: text.length, head: text.trim().slice(0, 60) });
  }
  return {
    file, total: msgs.length, byId, missingId,
    title: (data.metadata && data.metadata.title) || data.title || '(untitled)'
  };
}

const loaded = files.map(load);
const candidate = loaded[loaded.length - 1];
const references = loaded.slice(0, -1);

for (const f of loaded) {
  const tag = f === candidate ? 'candidate' : 'reference';
  say(`${tag.padEnd(9)} ${path.basename(path.dirname(f.file))}/${path.basename(f.file)}`);
  say(`          ${f.total} messages, ${f.byId.size} with ids` +
      (f.missingId ? `, ${f.missingId} WITHOUT ids` : ''));
}
say('');

// A file with no ids cannot take part, and saying so is the point: a silent
// "0 missing" from an id-less file would read as a pass.
const unusable = loaded.filter(f => f.byId.size === 0);
if (unusable.length) {
  say('ERROR: these files carry no message ids, so they cannot be compared:');
  for (const f of unusable) say(`  ${f.file}`);
  say('An export from before #294 has no ids. Re-capture with a current build.');
  say('This is NOT a pass — nothing was compared.');
  process.exit(2);
}

let worst = 0;
const union = new Set();
for (const r of references) for (const id of r.byId.keys()) union.add(id);

for (const r of references) {
  const missing = [...r.byId.keys()].filter(id => !candidate.byId.has(id));
  const label = `${path.basename(path.dirname(r.file))}`;
  say(`vs ${label}: ${r.byId.size} messages, ${missing.length} absent from the candidate`);
  for (const id of missing.slice(0, 10)) {
    const m = r.byId.get(id);
    say(`    ${id}  ${m.role.padEnd(9)} ${String(m.chars).padStart(6)} chars  ${m.head.replace(/\s+/g, ' ')}`);
  }
  if (missing.length > 10) say(`    ... and ${missing.length - 10} more`);
  worst = Math.max(worst, missing.length);
}

const gained = [...candidate.byId.keys()].filter(id => !union.has(id));
say('');
say(`candidate holds ${gained.length} message(s) no reference has`);
say('');

if (worst === 0) {
  say('SUPERSET: the candidate contains every message from every reference.');
  process.exit(0);
}
say(`NOT A SUPERSET: ${worst} message(s) from a reference are absent from the candidate.`);
process.exit(1);
