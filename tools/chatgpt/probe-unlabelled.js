// Why is the #263 sniffer firing on almost nothing?
//
//   node tools/chatgpt/probe-unlabelled.js
//
// The live verification labelled 4 of 43 blocks and 0 of 19 multi-line ones,
// with zero of those coming from the sniffer. Either the blocks genuinely carry
// no recoverable signal, or the patterns are aimed at the wrong shapes. Guessing
// which would repeat the mistake that made #263 survive its first repair, so
// this dumps the actual openings.
//
// Attaches to the window already open on 9333. Never closes the browser.
// First lines only, truncated, and written to clio-harvest, outside this repo.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const ROUNDS = Number(process.env.CLIO_ROUNDS || 8);
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(os.homedir(), 'Projects', 'clio-harvest',
  (process.env.CLIO_RUN || 'chatgpt-run'), 'unlabelled-probe.txt');

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

  await page.evaluate(() => {
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || { onMessage: { addListener: () => {} } };
  });
  for (const f of ['extensions/src/selectors-chatgpt.js', 'extensions/src/content.js']) {
    await page.evaluate((code) => { (0, eval)(code); },
      fs.readFileSync(path.join(REPO, f), 'utf8'));
  }

  await page.evaluate(() => {
    window.__sc = window.findScrollContainer();
    window.__u = new Map();
    window.__uSweep = () => {
      for (const pre of document.querySelectorAll('pre')) {
        const code = pre.querySelector('code') || pre.querySelector('.cm-content');
        if (!code) continue;
        if (window.outermostPre(code) !== pre) continue;
        const text = code.textContent || '';
        const lines = text.split('\n').filter(l => l.trim());
        const key = text.length + ':' + text.slice(0, 40);
        if (window.__u.has(key)) continue;
        // Does a header exist at all in the OUTER block, and what does it say?
        const header = pre.querySelector('[class*="sticky"], header, [class*="header"]');
        window.__u.set(key, {
          n: lines.length,
          lang: window.detectCodeLanguage(code, pre),
          header: header ? (header.textContent || '').trim().slice(0, 40) : null,
          first: (lines[0] || '').slice(0, 88),
          second: (lines[1] || '').slice(0, 60)
        });
      }
    };
    window.__uSweep();
  });

  for (let r = 0; r < ROUNDS; r++) {
    await page.evaluate(() => {
      if (window.__sc) {
        window.__sc.scrollTop = Math.max(0, window.__sc.scrollTop - window.__sc.clientHeight * 3);
        window.__sc.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    });
    await sleep(4500);
    await page.evaluate(() => window.__uSweep());
  }

  const rows = await page.evaluate(() => [...window.__u.values()]);

  const multi = rows.filter(r => r.n > 1);
  const withHeader = rows.filter(r => r.header !== null);
  say(`blocks seen: ${rows.length}   multi-line: ${multi.length}   with a header element: ${withHeader.length}`);
  say('');
  say('--- headers that DO exist ---');
  const heads = {};
  for (const r of withHeader) heads[r.header] = (heads[r.header] || 0) + 1;
  for (const [k, v] of Object.entries(heads).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    say(`  ${String(v).padStart(3)}  ${JSON.stringify(k)}`);
  }
  say('');
  say('--- multi-line blocks with NO language, first two lines ---');
  for (const r of multi.filter(r => !r.lang).slice(0, 30)) {
    say(`  [${String(r.n).padStart(3)} lines] ${JSON.stringify(r.first)}`);
    if (r.second) say(`               ${JSON.stringify(r.second)}`);
  }
  say('');
  say('--- single-line blocks with no language, a sample ---');
  for (const r of rows.filter(r => r.n === 1 && !r.lang).slice(0, 20)) {
    say(`  ${JSON.stringify(r.first)}`);
  }
  say('');
  say(`report: ${OUT}`);
  flush();
  // No close() — the operator owns that window.
}

main().catch((e) => {
  say('PROBE ERROR: ' + (e && e.stack ? e.stack : String(e)));
  flush();
  process.exitCode = 1;
});
