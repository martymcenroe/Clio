// Capture a conversation through the REAL extension: popup click to ZIP (#308).
//
//   CLIO_TARGET=chatgpt.com/c/<id> CLIO_OUT=<dir outside this repo> \
//     node tools/extension/capture-via-popup.js
//
// Every live verification before this ran content.js injected into the page's
// main world. That is a fair test of the extraction logic and not of the
// shipped artefact: a content script runs in an isolated world with the
// extension's host_permissions, which change what an image fetch may retrieve,
// and the delivery path — chrome.tabs.sendMessage, the blob-to-base64 hop,
// JSZip, chrome.downloads — had no live coverage at all.
//
// This drives the extension the operator loaded, unmodified, in the window on
// the CDP port. It opens the extension's own popup page in a small window of
// its own and clicks Extract. Two calls inside that page are seams, and only
// two:
//
//   chrome.tabs.query({active: true})  resolves to the target conversation's
//       tab — the job the operator's focus does when they click the toolbar
//       icon. Automation has no toolbar to click.
//   chrome.downloads.download(...)     hands over the exact blob the popup
//       built, rather than raising the Save As dialog the popup asks for
//       (saveAs: true), which automation cannot answer.
//
// Everything between them is the shipped code: the content script's
// extraction, its image fetches under the extension's permissions, the base64
// conversion for message passing, and JSZip.
//
// The popup page opens in a separate window, not a tab beside the
// conversation, because a hidden tab is throttled and ChatGPT's virtualized
// list does not render while hidden.
//
// Output: the ZIP, byte for byte, plus the popup's final status line, written
// to CLIO_OUT. That directory must be outside this repository: Clio is public
// and these are whole conversations (#250).
//
// Never closes a window or a tab. The operator owns the browser.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const TARGET = process.env.CLIO_TARGET;
const OUT = process.env.CLIO_OUT;
const TIMEOUT_MS = Number(process.env.CLIO_TIMEOUT_MS || 20 * 60 * 1000);
const REPO = path.resolve(__dirname, '..', '..');

const say = (s) => process.stdout.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The patch installed in the popup page before popup.js runs. */
function installSeams(target) {
  const realQuery = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = function (queryInfo, callback) {
    const promise = (queryInfo && queryInfo.active)
      ? realQuery({}).then((tabs) => tabs.filter((t) => t.url && t.url.includes(target)).slice(0, 1))
      : realQuery(queryInfo);
    if (typeof callback === 'function') { promise.then(callback); return undefined; }
    return promise;
  };

  window.__clioHarness = { zip: null, filename: null, error: null, downloads: 0 };
  chrome.downloads.download = function (options, callback) {
    window.__clioHarness.downloads++;
    fetch(options.url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        window.__clioHarness.zip = btoa(s);
        window.__clioHarness.filename = options.filename;
      })
      .catch((e) => { window.__clioHarness.error = String(e); });
    if (typeof callback === 'function') callback(1);
  };
}

async function findExtensionId(browser) {
  if (process.env.CLIO_EXT_ID) return process.env.CLIO_EXT_ID;
  const ext = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('chrome://extensions'));
  if (!ext) return null;
  const info = await ext.evaluate(() => new Promise((resolve) =>
    chrome.developerPrivate.getExtensionsInfo({ includeDisabled: false }, resolve)));
  const clio = info.find((e) => e.name === 'Clio' && e.state === 'ENABLED');
  return clio ? clio.id : null;
}

async function main() {
  if (!TARGET) { say('set CLIO_TARGET to a unique part of the conversation URL'); process.exitCode = 2; return; }
  if (!OUT) { say('set CLIO_OUT to the output directory'); process.exitCode = 2; return; }
  const out = path.resolve(OUT);
  if (out === REPO || out.startsWith(REPO + path.sep)) {
    say(`refusing to write inside the repository (${REPO}): Clio is public (#250)`);
    process.exitCode = 2;
    return;
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0];

  const target = context.pages().find((p) => p.url().includes(TARGET));
  if (!target) { say(`no open tab matches ${TARGET}`); process.exitCode = 1; return; }

  const extId = await findExtensionId(browser);
  if (!extId) {
    say('Clio not found: keep a chrome://extensions tab open in the window, or set CLIO_EXT_ID');
    process.exitCode = 1;
    return;
  }

  // A window of its own, so the conversation's tab stays visible.
  const cdp = await browser.newBrowserCDPSession();
  const before = new Set(context.pages());
  await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, width: 440, height: 680 });
  let popup = null;
  for (let i = 0; i < 50 && !popup; i++) {
    popup = context.pages().find((p) => !before.has(p)) || null;
    if (!popup) await sleep(100);
  }
  if (!popup) { say('the harness window did not appear'); process.exitCode = 1; return; }

  await popup.addInitScript(installSeams, TARGET);
  await popup.goto(`chrome-extension://${extId}/src/popup.html`);
  const seamed = await popup.evaluate(() => !!window.__clioHarness);
  if (!seamed) { say('the seams did not install before popup.js ran; nothing was clicked'); process.exitCode = 1; return; }

  await popup.waitForFunction(() => {
    const b = document.getElementById('extractBtn');
    return b && !b.disabled;
  }, null, { timeout: 30000 });
  say(`extension ${extId}, target ${target.url().replace(/^(https:\/\/[^/]+).*/, '$1/…')}`);
  say('clicking Extract');
  const t0 = Date.now();
  await popup.click('#extractBtn');

  const result = await popup.waitForFunction(() => {
    const h = window.__clioHarness;
    const status = document.getElementById('status');
    const cls = status ? status.className : '';
    if (h.zip || h.error) return { done: true };
    if (/\berror\b/.test(cls) && !/Extracting|Starting/.test(status.textContent)) return { done: true };
    return null;
  }, null, { timeout: TIMEOUT_MS, polling: 1000 });
  await result.dispose();

  const state = await popup.evaluate(() => ({
    zip: window.__clioHarness.zip,
    filename: window.__clioHarness.filename,
    error: window.__clioHarness.error,
    downloads: window.__clioHarness.downloads,
    status: (document.getElementById('status') || {}).textContent || '',
    statusClass: (document.getElementById('status') || {}).className || ''
  }));
  say(`finished in ${Math.round((Date.now() - t0) / 1000)}s`);
  say(`popup status [${state.statusClass}]: ${state.status}`);

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'popup-status.txt'), `${state.statusClass}\n${state.status}\n`);
  if (!state.zip) {
    say(state.error ? `no ZIP: ${state.error}` : 'no ZIP was produced');
    process.exitCode = 1;
    return;
  }
  const file = path.join(out, path.basename(state.filename || 'capture.zip'));
  fs.writeFileSync(file, Buffer.from(state.zip, 'base64'));
  say(`ZIP: ${file} (${fs.statSync(file).size} bytes)`);
  // No close(): the operator owns the windows, including this one.
}

main().catch((e) => {
  say('HARNESS ERROR: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
}).finally(() => process.exit(process.exitCode || 0));
