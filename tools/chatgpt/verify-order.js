// Verify reconstructed conversation order against ChatGPT's OWN numbering.
//
//   node tools/chatgpt/verify-order.js [conversation.json]
//
// The assistant numbered its responses in a number+letter progression
// ("92A. Codex upgrade — PASS", "143E. ..."). That labelling is produced by the
// conversation itself, so it is independent of every signal the scraper used —
// DOM order, turn testids, scroll offsets. If the reconstructed order is right,
// those labels must be non-decreasing.
//
// Exit code 0 = order verified, 1 = inversions found.

const fs = require('fs');
const path = require('path');

const file = process.argv[2] ||
  path.join(process.env.USERPROFILE || process.env.HOME, 'Projects', 'clio-harvest',
            (process.env.CLIO_RUN || 'chatgpt-run'), 'conversation.json');

const conv = JSON.parse(fs.readFileSync(file, 'utf8'));
const msgs = conv.messages || [];

// "92A." / "143E." / "84A —" at the head of an assistant message.
const LABEL = /^\s*(\d{1,4})([A-Za-z])\s*[.)—-]/;

const labelled = [];
msgs.forEach((m, i) => {
  if (m.role !== 'assistant') return;
  // `content` first: that is what the EXTENSION emits, and verifying the
  // extension's own export is the point of this tool. `text` is the harvester's
  // field name (tools/chatgpt/harvest.js). Reading only `text` meant that
  // pointing this at a real export found zero labelled messages and reported
  // "not enough labelled responses" — a clean-looking pass that had in fact
  // verified nothing.
  const head = (m.content || m.text || '').trim().split('\n').slice(0, 3).join('\n');
  const mt = head.match(LABEL);
  if (!mt) return;
  labelled.push({
    index: i,
    label: mt[1] + mt[2].toUpperCase(),
    key: Number(mt[1]) * 100 + (mt[2].toUpperCase().charCodeAt(0) - 65)
  });
});

console.log(`file: ${file}`);
console.log(`messages: ${msgs.length}   assistant messages carrying a step label: ${labelled.length}`);
console.log('');

if (labelled.length < 3) {
  // "No numbering in this conversation" and "I read the wrong key" produce the
  // same output otherwise, and the second one exits 0 having checked nothing.
  // That is the failure this tool exists to catch, in the tool itself.
  const withAnyText = msgs.filter(m => m.content || m.text).length;
  if (msgs.length > 0 && withAnyText === 0) {
    const keys = [...new Set(msgs.flatMap(m => Object.keys(m)))].sort();
    console.log('ERROR: no message carries `content` or `text`. Keys present: ' +
                keys.join(', '));
    console.log('This file cannot be checked, which is NOT the same as passing.');
    process.exit(2);
  }
  console.log(`Not enough labelled responses to verify ordering ` +
              `(${withAnyText} of ${msgs.length} messages had readable text).`);
  process.exit(0);
}

console.log('labels in file order:');
console.log('  ' + labelled.map(l => l.label).join(' '));
console.log('');

let inversions = 0;
const breaks = [];
for (let i = 1; i < labelled.length; i++) {
  if (labelled[i].key < labelled[i - 1].key) {
    inversions++;
    breaks.push(`${labelled[i - 1].label} -> ${labelled[i].label} (at message index ${labelled[i].index})`);
  }
}

// Longest non-decreasing run, as a measure of how close we are.
let best = 1, cur = 1;
for (let i = 1; i < labelled.length; i++) {
  cur = labelled[i].key >= labelled[i - 1].key ? cur + 1 : 1;
  if (cur > best) best = cur;
}

console.log(`adjacent inversions: ${inversions} of ${labelled.length - 1} transitions`);
console.log(`longest non-decreasing run: ${best} / ${labelled.length}`);
if (breaks.length) {
  console.log('breaks:');
  for (const b of breaks.slice(0, 25)) console.log(`  ${b}`);
}
console.log('');

// Does the transcript open on the message it should?
//
// This half is conversation-specific by nature: only you know what the first
// message says. Set CLIO_FIRST to a distinctive phrase from it. With no phrase
// given, the label check above still stands on its own — but say so, rather
// than reporting a pass on a check that never ran.
const FIRST = process.env.CLIO_FIRST || '';
let firstIdx = -1;
if (FIRST) {
  const re = new RegExp(FIRST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  firstIdx = msgs.findIndex(m => re.test(m.text || m.content || ''));
  console.log(`opening message at index:           ${firstIdx}${firstIdx === 0 ? '  (correct)' : '  (SHOULD BE 0)'}`);
} else {
  console.log('opening message:                    not checked (set CLIO_FIRST to a phrase from it)');
}

const opensCorrectly = FIRST ? firstIdx === 0 : true;
if (inversions === 0 && opensCorrectly) {
  console.log(`\nORDER VERIFIED: the conversation's own numbering is non-decreasing${
    FIRST ? ", and it opens on the first message" : ''}.`);
  process.exit(0);
}
console.log('\nORDER NOT VERIFIED.');
process.exit(1);
