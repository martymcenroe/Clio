// Write synthetic PNG test patterns for image-capture tests (#331).
//
//   node tools/extension/make-test-images.js <out-dir>
//
// Uploading a real photo to test image capture would put operator-identifiable
// content into a test conversation. These are generated: coloured bands over a
// checkerboard, no text, each pattern distinct, so a capture can be checked for
// WHICH image it holds as well as whether it holds one. Pure node (zlib), no
// dependencies. Refuses to write inside this repository (#250).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO = path.resolve(__dirname, '..', '..');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An RGB PNG of `size` px: horizontal bands in `colors`, a checker overlay. */
function pattern(size, colors, cell) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    const band = colors[Math.floor((y / size) * colors.length)];
    for (let x = 0; x < size; x++) {
      const dark = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) === 0;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = dark ? band[0] >> 1 : band[0];
      raw[o + 1] = dark ? band[1] >> 1 : band[1];
      raw[o + 2] = dark ? band[2] >> 1 : band[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const PATTERNS = {
  'clio-test-pattern-a.png': { size: 512, colors: [[220, 40, 40], [40, 160, 60], [40, 70, 220]], cell: 32 },
  'clio-test-pattern-b.png': { size: 384, colors: [[250, 200, 20], [20, 180, 200]], cell: 48 }
};

if (require.main === module) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!out) { process.stdout.write('usage: node tools/extension/make-test-images.js <out-dir>\n'); process.exit(2); }
  if (out === REPO || out.startsWith(REPO + path.sep)) {
    process.stdout.write(`refusing to write inside the repository (${REPO})\n`);
    process.exit(2);
  }
  fs.mkdirSync(out, { recursive: true });
  for (const [name, p] of Object.entries(PATTERNS)) {
    const png = pattern(p.size, p.colors, p.cell);
    fs.writeFileSync(path.join(out, name), png);
    process.stdout.write(`${path.join(out, name)}  ${png.length} bytes\n`);
  }
}

module.exports = { pattern, crc32, PATTERNS };
