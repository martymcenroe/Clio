// Tests for the provider-export checker's zip reader (runbook 30005).
//
// The reader walks the central directory by hand rather than trusting the file
// extension, and the reason is the failure it has to catch: a Takeout or ChatGPT
// download whose link expired mid-transfer leaves a file that is the right size
// on disk and not a working archive. "It ends in .zip" would pass that.
//
// Fixtures are built with jszip, which is already a dependency.

const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { zipEntryNames } = require('../tools/check-exports.js');

// Written under the OS temp dir ONLY because jest owns the lifetime here and the
// content is synthetic -- no operator data ever lands in these.
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'clio-export-test-'));
const made = [];

async function writeZip(name, files) {
  const zip = new JSZip();
  for (const [entry, body] of Object.entries(files)) zip.file(entry, body);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const file = path.join(workdir, name);
  fs.writeFileSync(file, buf);
  made.push(file);
  return file;
}

afterAll(() => {
  for (const f of made) { try { fs.unlinkSync(f); } catch (e) { /* already gone */ } }
  try { fs.rmdirSync(workdir); } catch (e) { /* not empty; harmless */ }
});

describe('zipEntryNames', () => {
  test('lists entries of a flat archive', async () => {
    const f = await writeZip('flat.zip', {
      'conversations.json': '[]',
      'user.json': '{}',
    });
    const { ok, names } = zipEntryNames(f);
    expect(ok).toBe(true);
    expect(names.sort()).toEqual(['conversations.json', 'user.json']);
  });

  test('lists nested entries, which is how Takeout ships', async () => {
    const f = await writeZip('nested.zip', {
      'Takeout/My Activity/Gemini Apps/MyActivity.json': '[]',
      'Takeout/archive_browser.html': '<html></html>',
    });
    const { ok, names } = zipEntryNames(f);
    expect(ok).toBe(true);
    expect(names).toContain('Takeout/My Activity/Gemini Apps/MyActivity.json');
    // The checker matches on the leaf, since the prefix varies by route and locale.
    expect(names.map((n) => n.split('/').pop())).toContain('MyActivity.json');
  });

  test('an archive with many entries is read completely', async () => {
    const files = {};
    for (let i = 0; i < 250; i++) files[`media/img-${i}.txt`] = String(i);
    files['conversations.json'] = '[]';
    const f = await writeZip('many.zip', files);
    const { ok, names } = zipEntryNames(f);
    expect(ok).toBe(true);
    // Archives carry directory entries alongside files -- real ones do too, so
    // the count is of actual files, not of central-directory records.
    expect(names.filter((n) => !n.endsWith('/'))).toHaveLength(251);
    expect(names).toContain('media/');
  });

  test('a truncated download is reported broken, not silently empty', async () => {
    const f = await writeZip('truncated.zip', { 'conversations.json': 'x'.repeat(5000) });
    const buf = fs.readFileSync(f);
    // Lop off the end-of-central-directory record, which is what a half-finished
    // transfer leaves behind.
    fs.writeFileSync(f, buf.subarray(0, buf.length - 40));
    const { ok, error } = zipEntryNames(f);
    expect(ok).toBe(false);
    expect(error).toMatch(/not a zip, or truncated/);
  });

  test('a file that is not a zip at all is reported, not thrown', async () => {
    const f = path.join(workdir, 'notazip.zip');
    fs.writeFileSync(f, 'This is an HTML error page the CDN served instead.');
    made.push(f);
    const { ok, error } = zipEntryNames(f);
    expect(ok).toBe(false);
    expect(error).toBeTruthy();
  });

  test('a missing file is reported, not thrown', () => {
    const { ok, error } = zipEntryNames(path.join(workdir, 'does-not-exist.zip'));
    expect(ok).toBe(false);
    expect(error).toBe('ENOENT');
  });
});
