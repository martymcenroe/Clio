// Verify the #263 / #262 fixes against the LIVE ChatGPT DOM.
//
//   node tools/chatgpt/verify-live.js
//
// Fixture tests prove the code does what the fixture says. They cannot prove
// the fixture matches the site — and on this repo they demonstrably did not:
// tests/fixtures/chatgpt-conversation.html carries <code data-language="python">,
// which the live site does not produce anywhere. So the real extension code is
// injected into the real page and its coverage measured.
//
// Injects extensions/src/selectors-chatgpt.js and extensions/src/content.js
// verbatim — no reimplementation, or this would be measuring a copy.
//
// Attaches to the window already open on 9333. Never closes the browser.
// Reports counts and language names only; no conversation content leaves the
// page. Output goes to clio-harvest, outside this repo.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const ROUNDS = Number(process.env.CLIO_ROUNDS || 8);
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(os.homedir(), 'Projects', 'clio-harvest',
  (process.env.CLIO_RUN || 'chatgpt-run'), 'verify-live.txt');

const out = [];
const say = (s) => { out.push(s); process.stdout.write(s + '\n'); };
function flush() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out.join('\n') + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page = null;
  for (const c of b.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com/.test(p.url())) { page = p; break; }
    if (page) break;
  }
  if (!page) { say('no ChatGPT page on 9333'); flush(); return; }
  say(`attached: ${page.url().slice(0, 60)}`);

  // content.js registers a chrome.runtime listener at the bottom; stub enough
  // of the API that injecting it does not throw.
  await page.evaluate(() => {
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime ||
      { onMessage: { addListener: () => {} } };
  });

  // addScriptTag is blocked by ChatGPT's CSP (script-src-elem with a nonce).
  // An indirect eval driven over CDP is not: Runtime.evaluate is not subject to
  // the page's CSP, and (0, eval) runs in global scope so the file's top-level
  // function declarations become window properties, exactly as a content script
  // would leave them.
  for (const f of ['extensions/src/selectors-chatgpt.js', 'extensions/src/content.js']) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    await page.evaluate((code) => { (0, eval)(code); }, src);
    say(`injected ${f}`);
  }
  flush();

  const ready = await page.evaluate(() => ({
    detect: typeof window.detectCodeLanguage === 'function',
    sniff: typeof window.sniffCodeLanguage === 'function',
    outer: typeof window.outermostPre === 'function',
    capture: typeof window.captureRenderedMessages === 'function',
    selectors: !!(window.SELECTORS && window.SELECTORS.uploadedFileCard)
  }));
  say(`functions available: ${JSON.stringify(ready)}`);
  if (!ready.detect || !ready.capture) {
    say('injection failed — the real code is not on the page, so nothing below would mean anything.');
    flush();
    return;
  }

  // Scroll back, sweeping exactly as the extension does, so the sample is the
  // whole conversation rather than one window.
  await page.evaluate(() => {
    window.__scroller = window.findScrollContainer();
    window.setMessageScroller(window.__scroller);
    window.resetMessageCache();
    window.setMessageScroller(window.__scroller);
    window.captureRenderedMessages();

    // Language coverage, accumulated across rounds and deduped by block text so
    // a block seen in several windows counts once.
    window.__lang = window.__lang || { seen: new Map() };
    window.__langSweep = () => {
      for (const pre of document.querySelectorAll('pre')) {
        const code = pre.querySelector('code') || pre.querySelector('.cm-content');
        if (!code) continue;
        const outer = window.outermostPre(code);
        if (outer !== pre) continue;                 // count each block once
        const text = code.textContent || '';
        const key = text.length + ':' + text.slice(0, 60);
        if (window.__lang.seen.has(key)) continue;
        window.__lang.seen.set(key, {
          lines: text.split('\n').filter(l => l.trim()).length,
          declared: window.detectCodeLanguageDeclaredOnly
            ? window.detectCodeLanguageDeclaredOnly(code, pre) : null,
          language: window.detectCodeLanguage(code, pre),
          sniffed: window.sniffCodeLanguage(text)
        });
      }
    };
    window.__langSweep();
  });

  for (let r = 0; r < ROUNDS; r++) {
    await page.evaluate(() => {
      const sc = window.__scroller;
      if (sc) {
        sc.scrollTop = Math.max(0, sc.scrollTop - sc.clientHeight * 3);
        sc.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    });
    await sleep(4500);
    const n = await page.evaluate(() => {
      window.captureRenderedMessages();
      window.remeasureRenderedMessages();
      window.__langSweep();
      return { msgs: window.getCaptureOrderStats().captured, blocks: window.__lang.seen.size };
    });
    say(`  round ${r + 1}: ${n.msgs} messages captured, ${n.blocks} distinct code blocks seen`);
    flush();
  }

  const result = await page.evaluate(() => {
    const blocks = [...window.__lang.seen.values()];
    const multi = blocks.filter(b => b.lines > 1);
    const counts = {};
    for (const b of blocks) {
      const k = b.language || '(none)';
      counts[k] = (counts[k] || 0) + 1;
    }
    // How many owe their label to sniffing rather than to a read label.
    const sniffOnly = blocks.filter(b => b.language && b.language === b.sniffed).length;

    const stats = window.getCaptureOrderStats();
    const els = window.getCapturedMessageEls();

    // Files captured during this scroll.
    let files = 0, artifacts = 0;
    for (const el of els) {
      const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id');
      for (const a of window.getMessageArtifacts(id) || []) {
        if (a.type === 'file') files++; else artifacts++;
      }
    }

    // Is the reconstructed order monotonic in the key it was built from?
    const keys = els.map(el => {
      const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id');
      return id;
    });

    return {
      blocks: blocks.length,
      multiline: multi.length,
      labelled: blocks.filter(b => b.language).length,
      labelledMulti: multi.filter(b => b.language).length,
      sniffOnly,
      counts,
      stats,
      files,
      artifacts,
      firstIds: keys.slice(0, 3),
      lastIds: keys.slice(-3)
    };
  });

  say('');
  say('=== #263 code-block language, measured on the live page ===');
  say(`  distinct code blocks seen:      ${result.blocks}`);
  say(`  of those, multi-line:           ${result.multiline}`);
  say(`  now carry a language:           ${result.labelled}  (multi-line: ${result.labelledMulti})`);
  say(`  label came from sniffing:       ${result.sniffOnly}`);
  say('  languages:');
  for (const [k, v] of Object.entries(result.counts).sort((a, b) => b[1] - a[1])) {
    say(`      ${String(v).padStart(4)}  ${k}`);
  }
  say('');
  say('=== #264 ordering ===');
  say(`  messages captured:              ${result.stats.captured}`);
  say(`  with an order key:              ${result.stats.withOrderKey}`);
  say(`  WITHOUT an order key:           ${result.stats.withoutOrderKey}`);
  say(`  never measured on settled DOM:  ${result.stats.neverMeasuredOnSettledDom}`);
  say('');
  say('=== #262 files captured during the scroll ===');
  say(`  uploaded file cards:            ${result.files}`);
  say(`  download affordances:           ${result.artifacts}`);
  say('');
  say(`report: ${OUT}`);
  flush();
  // No close() — the operator owns that window.
}

main().catch((e) => {
  say('VERIFY ERROR: ' + (e && e.stack ? e.stack : String(e)));
  flush();
  process.exitCode = 1;
});
