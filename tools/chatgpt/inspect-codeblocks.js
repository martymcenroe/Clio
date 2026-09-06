// Inspect a harvested conversation.json for code-block fidelity problems.
// Reports language coverage, size distribution, and the two truncation tells:
// a block whose text ends mid-token, and blocks whose line counts cluster at a
// suspiciously uniform value (the CodeMirror viewport height).

const fs = require('fs');
const path = require('path');

const file = process.argv[2] ||
  path.join(process.env.USERPROFILE || process.env.HOME, 'Projects', 'clio-harvest',
            (process.env.CLIO_RUN || 'chatgpt-run'), 'conversation.json');

const conv = JSON.parse(fs.readFileSync(file, 'utf8'));
const blocks = [];
for (const m of conv.messages) {
  for (const c of m.codeBlocks || []) blocks.push({ role: m.role, ...c });
}

console.log(`file: ${file}`);
console.log(`messages: ${conv.messages.length}`);
console.log(`code blocks: ${blocks.length}`);
console.log('');

const withLang = blocks.filter(b => b.language);
console.log(`language detected: ${withLang.length} / ${blocks.length}`);
const langs = {};
for (const b of blocks) {
  const k = b.language || '(null)';
  langs[k] = (langs[k] || 0) + 1;
}
for (const [k, v] of Object.entries(langs).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
console.log('');

const lines = blocks.map(b => (b.code || '').split('\n').length);
const chars = blocks.map(b => (b.code || '').length);
const sum = (a) => a.reduce((x, y) => x + y, 0);
console.log(`lines  min ${Math.min(...lines)}  max ${Math.max(...lines)}  mean ${(sum(lines) / lines.length).toFixed(1)}`);
console.log(`chars  min ${Math.min(...chars)}  max ${Math.max(...chars)}  total ${sum(chars)}`);
console.log('');

// Truncation tell 1: line counts clustering on one value means the viewport,
// not the content, decided where the block ended.
const hist = {};
for (const n of lines) hist[n] = (hist[n] || 0) + 1;
const clustered = Object.entries(hist).filter(([, v]) => v >= 3).sort((a, b) => b[1] - a[1]);
if (clustered.length) {
  console.log('line-count clusters (3+ blocks at the same length — possible viewport truncation):');
  for (const [n, v] of clustered.slice(0, 8)) console.log(`  ${v} blocks are exactly ${n} lines`);
} else {
  console.log('no line-count clustering — lengths look content-driven, not viewport-driven');
}
console.log('');

// Truncation tell 2: a code block that does not end on a plausible boundary.
const suspicious = blocks.filter(b => {
  const t = (b.code || '').trimEnd();
  if (!t) return false;
  const lastLine = t.split('\n').pop();
  return lastLine.length > 0 && !/[)\]}:;,"'`]$|^\s*$|^#|^\/\//.test(lastLine) && lastLine.length > 40;
});
console.log(`blocks ending mid-line (weak signal): ${suspicious.length} / ${blocks.length}`);
for (const b of suspicious.slice(0, 3)) {
  const tail = (b.code || '').trimEnd().split('\n').pop();
  console.log(`  ...${tail.slice(-70)}`);
}
console.log('');

const empty = blocks.filter(b => !(b.code || '').trim()).length;
console.log(`empty code blocks: ${empty}`);
