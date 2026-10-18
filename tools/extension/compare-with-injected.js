// Compare a ZIP the real extension produced against an injected capture of the
// same conversation, message by message (#308).
//
//   CLIO_TARGET=<url fragment> node tools/extension/compare-with-injected.js <file.zip>
//
// Every live check before #308 injected content.js into the page's main world.
// This says whether that was a valid stand-in for the shipped extension: same
// messages by id, same roles, same text lengths, same image attachments, and
// the same image-fetch outcome. A difference is the finding; agreement means
// the earlier injected results stand.
//
// The injected side runs the repository's selectors and content.js inside one
// function scope (as tools/chatgpt/verify-extract.js does), so it can be re-run
// without reloading. Run it right after the capture, on the same tab, so both
// sides saw the same conversation.
//
// Prints ids by shape, counts and lengths. No conversation text.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const JSZip = require(path.resolve(__dirname, '..', '..', 'extensions', 'lib', 'jszip.min.js'));

const PORT = Number(process.env.CLIO_PORT || 9333);
const TARGET = process.env.CLIO_TARGET;
const REPO = path.resolve(__dirname, '..', '..');
const say = (s) => process.stdout.write(s + '\n');

const SELECTOR_FILES = {
  chatgpt: 'extensions/src/selectors-chatgpt.js',
  claude: 'extensions/src/selectors-claude.js',
  gemini: 'extensions/src/selectors.js'
};

function siteOf(url) {
  if (url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('claude.ai')) return 'claude';
  return 'gemini';
}

const shape = (id) => (id ? (id.length > 12 ? `${id.slice(0, 4)}…(${id.length})` : id) : '-');

function summarize(messages) {
  return messages.map((m) => ({
    id: m.id || null,
    role: m.role,
    textLength: (m.content || '').length,
    images: (m.attachments || []).filter((a) => a.type === 'image').length,
    imagesFetched: (m.attachments || []).filter((a) => a.type === 'image' && a.filename).length,
    imageErrors: (m.attachments || []).filter((a) => a.type === 'image' && a.error).map((a) => a.error)
  }));
}

async function main() {
  const file = process.argv[2];
  if (!file || !TARGET) { say('usage: CLIO_TARGET=<url fragment> node tools/extension/compare-with-injected.js <file.zip>'); process.exitCode = 2; return; }

  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const fromZip = JSON.parse(await zip.file('conversation.json').async('string'));
  const real = summarize(fromZip.messages || []);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const page = browser.contexts()[0].pages().find((p) => p.url().includes(TARGET));
  if (!page) { say(`no open tab matches ${TARGET}`); process.exitCode = 1; return; }
  await page.bringToFront();

  const site = siteOf(page.url());
  const sources = [SELECTOR_FILES[site], 'extensions/src/content.js'].map((f) => fs.readFileSync(path.join(REPO, f), 'utf8'));
  const scoped = `(function () {
    const chrome = { runtime: { onMessage: { addListener: function () {} }, sendMessage: function () {} } };
    ${sources[0]}
    ${sources[1]}
    window.__clioCompare = { extractConversation };
  })();`;
  await page.evaluate((code) => { (0, eval)(code); }, scoped);
  const injectedResult = await page.evaluate(async () => {
    const r = await window.__clioCompare.extractConversation();
    return r.success ? { ok: true, messages: r.data.messages, metadata: r.data.metadata } : { ok: false, error: r.error };
  });
  if (!injectedResult.ok) { say(`injected capture failed: ${injectedResult.error}`); process.exitCode = 1; return; }
  const injected = summarize(injectedResult.messages);

  const byId = (list) => new Map(list.filter((m) => m.id).map((m) => [m.id, m]));
  const realById = byId(real);
  const injById = byId(injected);
  const onlyReal = [...realById.keys()].filter((id) => !injById.has(id));
  const onlyInjected = [...injById.keys()].filter((id) => !realById.has(id));
  const differing = [];
  for (const [id, r] of realById) {
    const j = injById.get(id);
    if (!j) continue;
    const fields = ['role', 'textLength', 'images', 'imagesFetched'].filter((f) => r[f] !== j[f]);
    if (fields.length || r.imageErrors.join('|') !== j.imageErrors.join('|')) differing.push({ id, fields, real: r, injected: j });
  }

  say(`site: ${site}`);
  say(`real extension (ZIP): ${real.length} messages, ${real.reduce((n, m) => n + m.images, 0)} image attachments, ${real.reduce((n, m) => n + m.imagesFetched, 0)} fetched`);
  say(`injected:             ${injected.length} messages, ${injected.reduce((n, m) => n + m.images, 0)} image attachments, ${injected.reduce((n, m) => n + m.imagesFetched, 0)} fetched`);
  say(`messages without an id: real ${real.filter((m) => !m.id).length}, injected ${injected.filter((m) => !m.id).length}`);
  say(`only in the real capture: ${onlyReal.length}${onlyReal.length ? '  ' + onlyReal.map(shape).join(' ') : ''}`);
  say(`only in the injected capture: ${onlyInjected.length}${onlyInjected.length ? '  ' + onlyInjected.map(shape).join(' ') : ''}`);
  say(`same id, different result: ${differing.length}`);
  for (const d of differing) {
    say(`  ${shape(d.id)} ${d.real.role}: ${d.fields.join(', ') || 'image errors'}`);
    say(`      real     ${JSON.stringify({ ...d.real, id: undefined })}`);
    say(`      injected ${JSON.stringify({ ...d.injected, id: undefined })}`);
  }
  const agree = !onlyReal.length && !onlyInjected.length && !differing.length && real.length === injected.length;
  say(agree ? 'VERDICT: the injected capture agrees with the real extension, message for message'
    : 'VERDICT: the two captures DIFFER — see above');
  if (!agree) process.exitCode = 1;
  // No close(): the operator owns the browser.
}

main().catch((e) => {
  say('COMPARE ERROR: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
}).finally(() => process.exit(process.exitCode || 0));
