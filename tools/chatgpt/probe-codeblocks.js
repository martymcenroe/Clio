// Third code-block probe (#263 + a double-count suspicion).
//
//   node tools/chatgpt/probe-codeblocks.js
//
// Settles two questions the first two probes raised:
//   1. Exactly how <code> and pre.cm-content nest inside the outer <pre>, and
//      therefore how many times 'pre code, pre .cm-content' fires per real
//      code block.
//   2. Whether ANY block on this conversation carries a language label, and if
//      so what element holds it — scrolling several screens to widen the sample
//      rather than judging from the four blocks at the bottom.
//
// Attaches to the window already open on 9333. Never closes the browser.
// Structural report only; output goes to clio-harvest, outside this repo.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const ROUNDS = Number(process.env.CLIO_ROUNDS || 6);
const OUT = path.join(os.homedir(), 'Projects', 'clio-harvest',
  (process.env.CLIO_RUN || 'chatgpt-run'), 'codeblock-probe3.txt');

const out = [];
const say = (s) => { out.push(s); process.stdout.write(s + '\n'); };
function flush() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out.join('\n') + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INSTALL = () => {
  const cls = (el) => String(el.className && el.className.baseVal !== undefined
    ? el.className.baseVal : (el.className || '')).slice(0, 60);
  const desc = (el) => `${el.tagName.toLowerCase()}.${cls(el).split(/\s+/).slice(0, 2).join('.')}`;

  window.__sc = (() => {
    let best = null, bestN = -1;
    for (const el of document.querySelectorAll('*')) {
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 100) {
        const n = el.querySelectorAll('[data-message-author-role]').length;
        if (n > bestN) { bestN = n; best = el; }
      }
    }
    return best;
  })();

  // Accumulate across rounds, deduped by a shape signature, because
  // virtualization means no single moment holds the whole sample.
  window.__cb = window.__cb || { shapes: new Map(), labelled: [], seen: new Set(), outer: 0, selMatches: 0 };

  window.__cbSweep = () => {
    const all = [...document.querySelectorAll('pre')];
    const outer = all.filter(p => !p.parentElement.closest('pre'));
    for (const pre of outer) {
      const code = pre.querySelector('code');
      const cm = pre.querySelector('.cm-content');
      // Path from the outer pre down to each, so nesting is unambiguous.
      const pathTo = (el) => {
        if (!el) return null;
        const parts = [];
        let cur = el;
        while (cur && cur !== pre) { parts.unshift(desc(cur)); cur = cur.parentElement; }
        return parts.join(' > ');
      };
      const codeInsideCm = !!(code && cm && cm.contains(code));
      const cmInsideCode = !!(code && cm && code.contains(cm));
      const sig = [
        `code:${code ? 'yes' : 'no'}`, `cm:${cm ? 'yes' : 'no'}`,
        `codeInCm:${codeInsideCm}`, `cmInCode:${cmInsideCode}`,
        `selPerBlock:${pre.querySelectorAll('pre code, pre .cm-content').length +
          ((code && code.matches && pre.matches('pre') && code.closest('pre') === pre) ? 0 : 0)}`
      ].join(' ');

      const key = sig + '|' + (pathTo(code) || '-') + '|' + (pathTo(cm) || '-');
      const rec = window.__cb.shapes.get(key) || {
        n: 0, sig, codePath: pathTo(code), cmPath: pathTo(cm),
        codeClosestIsOuter: code ? (code.closest('pre') === pre) : null,
        matchesUnderOuter: pre.querySelectorAll('pre code, pre .cm-content').length
      };
      rec.n++;
      window.__cb.shapes.set(key, rec);

      // Any text leaf inside the outer pre that is NOT inside the code content
      // is a label candidate.
      const content = cm || code;
      const labels = [...pre.querySelectorAll('*')]
        .filter(e => e.children.length === 0 && (e.textContent || '').trim())
        .filter(e => !content || !content.contains(e))
        .map(e => ({ d: desc(e), text: (e.textContent || '').trim().slice(0, 30) }));
      if (labels.length) {
        const lk = labels.map(l => `${l.d}=${l.text}`).join(' ; ').slice(0, 160);
        if (!window.__cb.seen.has(lk)) {
          window.__cb.seen.add(lk);
          window.__cb.labelled.push({ preCls: cls(pre), labels });
        }
      }
    }
    window.__cb.outer = Math.max(window.__cb.outer, outer.length);
    window.__cb.selMatches = Math.max(window.__cb.selMatches,
      document.querySelectorAll('pre code, pre .cm-content').length);
    return outer.length;
  };
  window.__cbSweep();
};

async function main() {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page = null;
  for (const c of b.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com/.test(p.url())) { page = p; break; }
    if (page) break;
  }
  if (!page) { say('no ChatGPT page on 9333'); flush(); return; }
  say(`attached: ${page.url().slice(0, 60)}`);

  await page.evaluate(INSTALL);

  for (let r = 0; r < ROUNDS; r++) {
    await page.evaluate(() => {
      if (window.__sc) {
        window.__sc.scrollTop = Math.max(0, window.__sc.scrollTop - window.__sc.clientHeight * 3);
        window.__sc.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    });
    await sleep(4000);
    const n = await page.evaluate(() => window.__cbSweep());
    say(`  round ${r + 1}: ${n} outer <pre> in view`);
    flush();
  }

  const report = await page.evaluate(() => ({
    shapes: [...window.__cb.shapes.values()],
    labelled: window.__cb.labelled,
    outer: window.__cb.outer,
    selMatches: window.__cb.selMatches,
    fileCards: document.querySelectorAll('[data-testid="library-file-icon"]').length,
    dl: [...document.querySelectorAll('button, a, [role="menuitem"]')]
      .map(el => (el.getAttribute('aria-label') || el.innerText || '').trim())
      .filter(l => /^download\b/i.test(l))
  }));

  say('');
  say('=== nesting shapes seen (deduped) ===');
  for (const s of report.shapes.sort((a, b) => b.n - a.n)) {
    say(`  x${s.n}  ${s.sig}`);
    say(`        outer pre > code  :  ${s.codePath}`);
    say(`        outer pre > .cm-content :  ${s.cmPath}`);
    say(`        code.closest('pre') === outer pre : ${s.codeClosestIsOuter}`);
    say(`        'pre code, pre .cm-content' matches under this block: ${s.matchesUnderOuter}`);
  }
  say('');
  say(`most outer <pre> in view at once : ${report.outer}`);
  say(`most selector matches at once    : ${report.selMatches}`);
  say('');
  say(`=== label candidates (text inside the outer pre but outside the code content) ===`);
  if (!report.labelled.length) say('  NONE on any block seen — these blocks carry no language label at all.');
  for (const l of report.labelled.slice(0, 20)) {
    say(`  pre.${l.preCls}`);
    for (const x of l.labels) say(`      ${x.d}  ${JSON.stringify(x.text)}`);
  }
  say('');
  say(`uploaded file cards in view: ${report.fileCards}`);
  say(`download affordances:       ${report.dl.length}  ${JSON.stringify(report.dl.slice(0, 10))}`);
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
