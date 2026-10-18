// Summarize a ZIP the extension produced, structurally (#308, #331).
//
//   node tools/extension/inspect-zip.js <file.zip> [--json]
//
// The question this answers is "is what the export claims actually in the
// file". An image counted as captured must be bytes in the ZIP that decode as
// an image, not a filename in conversation.json pointing at nothing (#331,
// definition of done item 3). So for every image attachment the export lists,
// this checks that the file exists, is non-empty, and starts with the magic
// bytes of an image format.
//
// Prints counts, sizes, formats and metadata flags. No conversation text.

const fs = require('fs');
const path = require('path');
const JSZip = require(path.resolve(__dirname, '..', '..', 'extensions', 'lib', 'jszip.min.js'));

/** Image format from the first bytes, or null. */
function sniffImage(bytes) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'avif/heif';
  const head = Buffer.from(b.subarray(0, 64)).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  return null;
}

async function inspect(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const conv = JSON.parse(await zip.file('conversation.json').async('string'));
  const md = conv.metadata || {};
  const messages = conv.messages || conv.turns || [];

  const imageFiles = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith('images/')) continue;
    const bytes = await entry.async('uint8array');
    imageFiles[name] = { bytes: bytes.length, format: sniffImage(bytes) };
  }

  const attachments = [];
  messages.forEach((m, i) => {
    for (const a of m.attachments || []) {
      if (a.type !== 'image') continue;
      const name = a.filename ? (a.filename.startsWith('images/') ? a.filename : `images/${a.filename}`) : null;
      const f = name ? imageFiles[name] : null;
      attachments.push({
        message: i,
        role: m.role,
        filename: name,
        inZip: !!f,
        bytes: f ? f.bytes : 0,
        format: f ? f.format : null,
        error: a.error || null,
        srcScheme: a.originalSrc ? String(a.originalSrc).split(':')[0] : null
      });
    }
  });

  return {
    file: path.basename(file),
    messages: messages.length,
    roles: messages.reduce((m, x) => { m[x.role] = (m[x.role] || 0) + 1; return m; }, {}),
    metadata: {
      messageCount: md.messageCount,
      imageCount: md.imageCount,
      imagesOffered: md.imagesOffered,
      mediaErrors: (md.mediaErrors || []).length,
      decorationSkipped: md.decorationSkipped,
      contentComplete: md.contentComplete,
      incompleteReasons: md.incompleteReasons
    },
    imageFiles,
    attachments,
    verdict: {
      attachmentsListed: attachments.length,
      attachmentsWithBytes: attachments.filter((a) => a.inZip && a.bytes > 0 && a.format).length,
      attachmentsMissingOrBroken: attachments.filter((a) => !(a.inZip && a.bytes > 0 && a.format)).length,
      imageFilesInZip: Object.keys(imageFiles).length,
      imageFilesNotDecodable: Object.values(imageFiles).filter((f) => !f.format).length
    }
  };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { process.stdout.write('usage: node tools/extension/inspect-zip.js <file.zip> [--json]\n'); process.exit(2); }
  inspect(file).then((r) => {
    if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return; }
    const say = (s) => process.stdout.write(s + '\n');
    say(`${r.file}: ${r.messages} messages ${JSON.stringify(r.roles)}`);
    say(`metadata: ${JSON.stringify(r.metadata)}`);
    say(`image files in ZIP: ${r.verdict.imageFilesInZip} (not decodable as an image: ${r.verdict.imageFilesNotDecodable})`);
    for (const [name, f] of Object.entries(r.imageFiles)) say(`  ${name}  ${f.bytes} bytes  ${f.format || 'NOT AN IMAGE'}`);
    say(`image attachments listed: ${r.verdict.attachmentsListed}, with bytes: ${r.verdict.attachmentsWithBytes}, missing or broken: ${r.verdict.attachmentsMissingOrBroken}`);
    for (const a of r.attachments) {
      say(`  message ${a.message} (${a.role}): ${a.filename || '(no file)'}  ${a.inZip ? `${a.bytes} bytes ${a.format || 'NOT AN IMAGE'}` : 'NOT IN ZIP'}  src=${a.srcScheme}${a.error ? `  error: ${a.error}` : ''}`);
    }
  }).catch((e) => { process.stdout.write('INSPECT ERROR: ' + e.message + '\n'); process.exit(1); });
}

module.exports = { inspect, sniffImage };
