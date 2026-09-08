#!/usr/bin/env node
// Are the provider data exports actually here? (runbook 30005)
//
// "Completion criteria: acquiring all of them" needs to be a program, not a
// sentence someone remembers writing. This is that program.
//
//   node tools/check-exports.js
//   node tools/check-exports.js --root <dir>
//
// Exits 0 only when every provider is satisfied, so it can gate later work.
//
// It reports presence, that the archive opens, and that the expected top-level
// member is inside. It NEVER prints conversation content -- only file names,
// sizes and counts. These archives are the operator's complete history with each
// provider; nothing in here should put any of it on a terminal.

const fs = require('fs');
const os = require('os');
const path = require('path');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : (process.argv[i + 1] || dflt);
};

const ROOT = arg('root', path.join(os.homedir(), 'Projects', 'clio-harvest', 'exports'));

const PROVIDERS = [
  {
    key: 'chatgpt',
    // The server-side message tree. This is the file that can see what the DOM
    // never rendered, so an archive without it is not the export we need.
    wants: ['conversations.json'],
    note: 'ground truth for #332, #330, #316',
  },
  {
    key: 'claude',
    wants: ['conversations.json'],
    note: 'baseline for #309',
  },
  {
    key: 'gemini',
    // Takeout nests Gemini under My Activity and the exact path varies by
    // route and locale, so match on the leaf name rather than a full path.
    wants: ['MyActivity.json', 'MyActivity.html', 'conversations.json'],
    anyOf: true,
    note: 'baseline for #309 and #217; Takeout layout varies',
  },
];

/**
 * Central-directory scan of a zip, without a dependency.
 *
 * Only the file NAMES are read -- entries are never decompressed. Reading the
 * central directory rather than trusting the extension also means a truncated
 * or half-downloaded archive fails here instead of three steps later.
 *
 * @returns {{ok: boolean, names: string[], error?: string}}
 */
function zipEntryNames(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return { ok: false, names: [], error: e.code || 'unreadable' }; }
  // End of central directory record: signature 0x06054b50, within the last 64K.
  const sig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === sig) { eocd = i; break; }
  }
  if (eocd === -1) return { ok: false, names: [], error: 'not a zip, or truncated' };

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      return { ok: false, names, error: `central directory ended early at entry ${n}` };
    }
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    names.push(buf.toString('utf8', off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { ok: true, names };
}

const human = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB`
  : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB`
    : `${(n / 1e3).toFixed(0)} KB`);

function main() {
let failures = 0;
const say = (s) => process.stdout.write(s + '\n');

say(`checking ${ROOT}`);
say('');

for (const p of PROVIDERS) {
  const dir = path.join(ROOT, p.key);
  const label = p.key.padEnd(9);

  if (!fs.existsSync(dir)) {
    say(`  ${label} MISSING    no directory yet -- ${p.note}`);
    failures++;
    continue;
  }

  const zips = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .map((f) => path.join(dir, f));

  if (!zips.length) {
    // An already-unpacked export still counts, as long as the file we need is there.
    const loose = fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
      : [];
    const hit = p.wants.filter((w) => loose.includes(w));
    if (hit.length) {
      say(`  ${label} OK         unpacked, found ${hit.join(', ')}`);
      continue;
    }
    say(`  ${label} MISSING    directory exists but holds no .zip -- ${p.note}`);
    failures++;
    continue;
  }

  // Newest archive wins; re-requests are common and the latest is the real one.
  zips.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const zip = zips[0];
  const size = fs.statSync(zip).size;
  const { ok, names, error } = zipEntryNames(zip);

  if (!ok) {
    say(`  ${label} BROKEN     ${path.basename(zip)} (${human(size)}) -- ${error}`);
    say(`  ${''.padEnd(9)}            re-download; the link may have expired mid-transfer`);
    failures++;
    continue;
  }

  const leaf = (n) => n.split('/').pop();
  const found = p.wants.filter((w) => names.some((n) => leaf(n) === w));
  const satisfied = p.anyOf ? found.length > 0 : found.length === p.wants.length;

  if (!satisfied) {
    say(`  ${label} INCOMPLETE ${path.basename(zip)} (${human(size)}, ${names.length} entries)`);
    say(`  ${''.padEnd(9)}            wanted ${p.anyOf ? 'any of' : 'all of'} ${p.wants.join(', ')}`);
    failures++;
    continue;
  }

  if (zips.length > 1) {
    say(`  ${label} OK         ${path.basename(zip)} (${human(size)}, ${names.length} entries)  ` +
        `[newest of ${zips.length}]`);
  } else {
    say(`  ${label} OK         ${path.basename(zip)} (${human(size)}, ${names.length} entries)`);
  }
}

say('');
if (failures) {
  say(`${failures} of ${PROVIDERS.length} provider(s) not yet acquired. See docs/runbooks/30005-requesting-provider-data-exports.md`);
  process.exit(1);
}
say(`all ${PROVIDERS.length} provider exports present and readable.`);
}

if (require.main === module) main();

module.exports = { zipEntryNames, PROVIDERS };
