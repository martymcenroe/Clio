// A/B the #263 header fix on the LIVE DOM.
//
//   node tools/chatgpt/probe-ab.js
//
// The claim under test is narrow and worth proving rather than asserting: the
// label was being missed because the SEARCH SCOPE was wrong, not because the
// selector was. `closest('pre')` from the <code> stops at ChatGPT's inner
// CodeMirror pre, and any header sits above the editor in the OUTER pre.
//
// So: for every block, look for a header the old way (scope = closest('pre'))
// and the new way (scope = outermostPre(code)), and count.
//
// Also reports how many unlabelled blocks are plausibly code at all — the
// denominator that makes the coverage figure honest. ChatGPT fences ASCII
// diagrams, PASS/FAIL tables and directory trees too, and those have no
// language to find.
//
// Attaches to the window already open on 9333. Never closes the browser.
// Counts only; written to clio-harvest, outside this repo.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const ROUNDS = Number(process.env.CLIO_ROUNDS || 10);
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(os.homedir(), 'Projects', 'clio-harvest',
  (process.env.CLIO_RUN || 'chatgpt-run'), 'ab-probe.txt');

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
    window.__ab = new Map();

    const HEADER_SEL = '[class*="sticky"], header, [class*="header"]';
    // Is this block plausibly source code at all? Deliberately generous: the
    // point is an honest denominator, so anything that could be code counts.
    const looksLikeCode = (text) => {
      if (/[│└├─┌┐┘↓→]/.test(text)) return false;              // ASCII diagram
      if (/^\s*(PASS|FAIL|OK|SKIP)\b/m.test(text)) return false; // result table
      const lines = text.split('\n').filter(l => l.trim());
      if (!lines.length) return false;
      const codey = lines.filter(l =>
        /[;{}()=<>|&$]|^\s*(#|\/\/|--)|^\s*[\w.-]+\s+[-\/]{1,2}\w/.test(l)).length;
      return codey / lines.length >= 0.4;
    };

    window.__abSweep = () => {
      for (const pre of document.querySelectorAll('pre')) {
        const code = pre.querySelector('code') || pre.querySelector('.cm-content');
        if (!code) continue;
        if (window.outermostPre(code) !== pre) continue;
        const text = code.textContent || '';
        const key = text.length + ':' + text.slice(0, 40);
        if (window.__ab.has(key)) continue;

        const oldScope = code.closest('pre');            // the pre-fix scope
        const newScope = window.outermostPre(code);      // the post-fix scope

        window.__ab.set(key, {
          lines: text.split('\n').filter(l => l.trim()).length,
          oldHeader: !!(oldScope && oldScope.querySelector(HEADER_SEL)),
          newHeader: !!(newScope && newScope.querySelector(HEADER_SEL)),
          language: window.detectCodeLanguage(code, oldScope),
          sniffed: window.sniffCodeLanguage(text),
          codeLike: looksLikeCode(text)
        });
      }
    };
    window.__abSweep();
  });

  for (let r = 0; r < ROUNDS; r++) {
    await page.evaluate(() => {
      if (window.__sc) {
        window.__sc.scrollTop = Math.max(0, window.__sc.scrollTop - window.__sc.clientHeight * 3);
        window.__sc.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    });
    await sleep(4500);
    await page.evaluate(() => window.__abSweep());
  }

  const rows = await page.evaluate(() => [...window.__ab.values()]);

  const oldFound = rows.filter(r => r.oldHeader).length;
  const newFound = rows.filter(r => r.newHeader).length;
  const labelled = rows.filter(r => r.language);
  const codeLike = rows.filter(r => r.codeLike);
  const codeLikeLabelled = codeLike.filter(r => r.language).length;

  say(`blocks seen: ${rows.length}`);
  say('');
  say('=== the claim: the search SCOPE was wrong, not the selector ===');
  say(`  header found searching closest('pre')   [old]: ${oldFound}`);
  say(`  header found searching outermostPre()   [new]: ${newFound}`);
  say('');
  say('=== resulting coverage ===');
  say(`  blocks now carrying a language:               ${labelled.length}`);
  say(`  ...of which the label came from a sniff:      ${labelled.filter(r => !r.newHeader).length}`);
  say('');
  say('=== an honest denominator ===');
  say(`  blocks that plausibly ARE code:               ${codeLike.length} / ${rows.length}`);
  say(`  of those, labelled:                           ${codeLikeLabelled}`);
  say(`  the rest are diagrams, tables, trees, prose — no language to find.`);
  say('');
  const langs = {};
  for (const r of rows) { const k = r.language || '(none)'; langs[k] = (langs[k] || 0) + 1; }
  for (const [k, v] of Object.entries(langs).sort((a, b) => b[1] - a[1])) {
    say(`      ${String(v).padStart(4)}  ${k}`);
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
