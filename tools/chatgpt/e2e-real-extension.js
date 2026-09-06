// End-to-end: load the REAL packed extension and run a REAL extraction.
//
//   node tools/chatgpt/e2e-real-extension.js
//
// Everything so far verified the extraction FUNCTIONS against the live page by
// injecting content.js. This verifies the shipped path: Chrome loads
// extensions/ from disk as an unpacked MV3 extension, the content script is
// injected by the manifest into an isolated world, and the extraction is
// triggered by exactly the message popup.js sends —
// chrome.tabs.sendMessage(tabId, { action: 'extract' }).
//
// Launches its own Chrome on a separate port and profile so the operator's
// window on 9333 is untouched. Never closes any browser.
//
// The extracted conversation is the operator's content, so it is written to
// clio-harvest, OUTSIDE this public repo. Only counts are printed.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const EXT = process.env.CLIO_EXT || path.join(REPO, 'data', 'ext-165');
const PROFILE = process.env.CLIO_PROFILE ||
  path.join(os.homedir(), '.clio-profiles', 'chatgpt-b');
const PORT = Number(process.env.CLIO_PORT || 9444);
const URL = process.env.CLIO_URL ||
  'https://chatgpt.com/';
const OUTDIR = path.join(os.homedir(), 'Projects', 'clio-harvest', (process.env.CLIO_RUN || 'chatgpt-run'));
const OUT = path.join(OUTDIR, 'e2e-extension.txt');

const out = [];
const say = (s) => { out.push(s); process.stdout.write(s + '\n'); };
function flush() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(OUT, out.join('\n') + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  say(`loading unpacked extension from ${EXT}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  say(`manifest version: ${manifest.version}`);
  flush();

  // channel:'chrome' — the profile is written by real Chrome and the bundled
  // chromium aborts on it. MV3 needs a persistent context to host the worker.
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1600, height: 950 },
    acceptDownloads: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--enable-unsafe-extension-debugging',
      `--remote-debugging-port=${PORT}`,
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`
    ]
  });

// Chrome 137+ ignores --load-extension. The supported path now is the CDP
  // command Extensions.loadUnpacked, gated behind --enable-unsafe-extension-debugging.
  const probe = ctx.pages()[0] || (await ctx.newPage());
  await probe.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await probe.evaluate(() => 1);

  // Ask Chrome to load it over CDP when the command-line flag was ignored.
  let worker = ctx.serviceWorkers()[0];
  if (!worker) {
    for (const method of ['Extensions.loadUnpacked']) {
      try {
        const cdp = await ctx.newCDPSession(probe);
        const loaded = await cdp.send(method, { path: EXT });
        say(`${method} -> ${JSON.stringify(loaded)}`);
      } catch (e) {
        say(`${method} failed: ${String(e.message || e).split('\n')[0].slice(0, 160)}`);
      }
    }
    flush();
  }

  // The MV3 service worker is the extension actually being loaded.
  for (let i = 0; i < 25 && !worker; i++) {
    await sleep(1000);
    worker = ctx.serviceWorkers()[0];
  }
  if (!worker) { say('no extension service worker appeared — the extension did not load.'); flush(); return; }
  const extId = new URL(worker.url()).host;
  say(`extension service worker up, id ${extId}`);
  flush();

  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-message-author-role]').length);
    if (n >= 1) break;
    await sleep(2000);
  }
  await sleep(5000);
  say(`conversation open: ${(await page.title()).slice(0, 60)}`);

  // Is the content script actually in there? It lives in an isolated world, so
  // the page context cannot see it — the tab answering the message is the proof.
  say('sending { action: "extract" }, exactly as popup.js does...');
  flush();

  const started = Date.now();
  const result = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    if (!tabs.length) return { ok: false, why: 'no chatgpt tab' };
    return await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'extract' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, why: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true, response });
      });
    });
  });
  const secs = Math.round((Date.now() - started) / 1000);

  if (!result.ok) {
    say(`EXTRACTION DID NOT RUN: ${result.why}`);
    flush();
    return;
  }

  const r = result.response;
  say('');
  say(`--- extraction returned after ${secs}s ---`);
  say(`  success:        ${r.success}`);
  if (!r.success) { say(`  error: ${r.error}`); flush(); return; }

  const md = r.data.metadata;
  say(`  messages:       ${md.messageCount}`);
  say(`  images:         ${md.imageCount}`);
  say(`  files:          ${md.fileCount}`);
  say(`  partialSuccess: ${md.partialSuccess}`);
  say(`  warnings:       ${JSON.stringify(r.warnings)}`);
  say(`  orderInfo:      ${JSON.stringify(md.orderInfo)}`);
  say('');

  const msgs = r.data.messages || [];
  const roles = msgs.reduce((a, m) => { a[m.role] = (a[m.role] || 0) + 1; return a; }, {});
  say(`  roles:          ${JSON.stringify(roles)}`);

  const fences = msgs.reduce((a, m) => a + ((m.content || '').match(/```/g) || []).length / 2, 0);
  const langs = {};
  for (const m of msgs) {
    for (const mt of (m.content || '').matchAll(/```([a-z0-9+#._-]*)\n/g)) {
      const k = mt[1] || '(none)';
      langs[k] = (langs[k] || 0) + 1;
    }
  }
  say(`  code fences:    ${fences}`);
  say(`  fence languages: ${JSON.stringify(langs)}`);

  const atts = {};
  for (const m of msgs) for (const a of (m.attachments || [])) atts[a.type] = (atts[a.type] || 0) + 1;
  say(`  attachments:    ${JSON.stringify(atts)}`);

  // Chrome's "Copy" chrome leaking into text was a real defect; check it is gone.
  const stray = msgs.filter(m => /```[\s\S]*?```\s*Copy/.test(m.content || '')).length;
  say(`  messages with a stray "Copy" beside a fence: ${stray}`);

  // Order sanity, from the conversation's own opening line.
  const firstIdx = msgs.findIndex(m => /i have been working on a project/i.test(m.content || ''));
  say(`  index of the conversation's first message: ${firstIdx}`);

  const dest = path.join(OUTDIR, 'e2e-conversation.json');
  fs.writeFileSync(dest, JSON.stringify(r.data, null, 2));
  say(`  export written OUTSIDE the repo: ${dest} (${fs.statSync(dest).size} bytes)`);

  say('');
  say(`report: ${OUT}`);
  flush();
  // No close() — the operator owns his windows, and this one too.
}

main().catch((e) => {
  say('E2E ERROR: ' + (e && e.stack ? e.stack : String(e)));
  flush();
  process.exitCode = 1;
});
