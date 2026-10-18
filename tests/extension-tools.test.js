/**
 * tools/extension (#406): the parts that can be tested without a browser.
 *
 * The live half (capture-via-popup.js, compare-with-injected.js) needs the
 * real extension loaded in a real Chrome, which is the point of it. What runs
 * here: the synthetic test images are real PNGs, the ZIP inspector tells an
 * image from a non-image, and no tool writes inside this repository (#250).
 *
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { pattern, PATTERNS } = require('../tools/extension/make-test-images.js');
const { sniffImage } = require('../tools/extension/inspect-zip.js');

const REPO = path.resolve(__dirname, '..');

describe('make-test-images', () => {
  test.each(Object.entries(PATTERNS))('%s is a PNG the inspector recognises', (_name, p) => {
    const png = pattern(p.size, p.colors, p.cell);
    expect(sniffImage(new Uint8Array(png))).toBe('png');
    // IHDR carries the declared size.
    expect(png.readUInt32BE(16)).toBe(p.size);
    expect(png.readUInt32BE(20)).toBe(p.size);
  });

  test('the patterns differ, so a capture can be checked for WHICH image it holds', () => {
    const [a, b] = Object.values(PATTERNS).map((p) => pattern(p.size, p.colors, p.cell));
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  test('refuses to write inside the repository', () => {
    const inside = path.join(REPO, 'data', 'should-not-exist-406');
    const r = spawnSync(process.execPath, [path.join(REPO, 'tools/extension/make-test-images.js'), inside], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/refusing to write inside the repository/);
    expect(fs.existsSync(inside)).toBe(false);
  });
});

describe('inspect-zip sniffImage', () => {
  const bytes = (...b) => new Uint8Array(b);
  test.each([
    ['jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['gif', bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)],
    ['webp', bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)]
  ])('recognises %s', (format, b) => {
    expect(sniffImage(b)).toBe(format);
  });

  test('an HTML error page saved as .png is not an image', () => {
    expect(sniffImage(new Uint8Array(Buffer.from('<!doctype html><html>403</html>')))).toBeNull();
  });
});

describe('capture-via-popup', () => {
  test('refuses an output directory inside the repository before touching the browser', () => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'tools/extension/capture-via-popup.js')], {
      encoding: 'utf8',
      env: { ...process.env, CLIO_TARGET: 'x', CLIO_OUT: path.join(REPO, 'data', 'should-not-exist-406'), CLIO_PORT: '1' }
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/refusing to write inside the repository/);
  });
});
