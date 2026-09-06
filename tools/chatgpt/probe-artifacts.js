// Probe the canvas/artifact surface on the ALREADY-OPEN ChatGPT window.
//
//   node tools/chatgpt/probe-artifacts.js
//
// Attaches over CDP to the window harvest2 left open (port 9333). Read-only:
// it never clicks, never navigates, and never closes the browser — the
// operator owns that window.
//
// Goal: find out how artifacts are represented, so #262 can capture them
// during the scroll instead of scraping <pre> after it.
//
// Structure and labels only — no document content is printed.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(os.homedir(), 'Projects', 'clio-harvest', (process.env.CLIO_RUN || 'chatgpt-run'), 'artifact-probe.txt');
const lines = [];
const say = (s) => { lines.push(s); process.stdout.write(s + '\n'); };

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  let page = null;
  for (const c of contexts) {
    for (const p of c.pages()) {
      if (/chatgpt\.com\/c\//.test(p.url())) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { say('no ChatGPT conversation page found on the attached browser'); return; }

  say(`attached to: ${page.url().replace(/\/c\/[0-9a-f-]+/i, '/c/<redacted>')}`);

  const report = await page.evaluate(() => {
    const desc = (el) => {
      const parts = [];
      let cur = el;
      while (cur && cur !== document.documentElement && parts.length < 7) {
        let s = cur.tagName.toLowerCase();
        if (cur.id) s += '#' + cur.id;
        if (cur.classList && cur.classList.length) s += '.' + [...cur.classList].slice(0, 3).join('.');
        parts.unshift(s);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    };

    // 1. Everything that offers a download right now.
    const dl = [];
    for (const el of document.querySelectorAll('button, a, [role="menuitem"]')) {
      const label = (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 100);
      if (/download|export|save/i.test(label)) {
        dl.push({
          tag: el.tagName.toLowerCase(),
          label,
          href: el.getAttribute('href') || null,
          testid: el.getAttribute('data-testid') || null,
          selector: desc(el),
          visible: !!el.offsetParent
        });
      }
    }

    // 2. Anything that looks like a canvas / artifact surface.
    const canvasish = [];
    const pat = /canvas|artifact|textdoc|document|side-?pane|sidepanel/i;
    for (const el of document.querySelectorAll('*')) {
      const id = el.id || '';
      const cls = typeof el.className === 'string' ? el.className : '';
      const tid = el.getAttribute('data-testid') || '';
      const tag = el.tagName.toLowerCase();
      if (pat.test(id) || pat.test(cls) || pat.test(tid) || pat.test(tag)) {
        canvasish.push({ tag, id, testid: tid, cls: cls.slice(0, 90), selector: desc(el) });
      }
      if (canvasish.length >= 60) break;
    }

    // 3. Attributes that might key an artifact.
    const attrs = {};
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes) {
        if (/textdoc|artifact|canvas|document-id|pointer/i.test(a.name)) {
          attrs[a.name] = (attrs[a.name] || 0) + 1;
        }
      }
    }

    // 4. Distinct data-testid values, which is how ChatGPT tends to mark UI.
    const testids = {};
    for (const el of document.querySelectorAll('[data-testid]')) {
      const t = el.getAttribute('data-testid');
      const key = t.replace(/\d+$/, 'N');
      testids[key] = (testids[key] || 0) + 1;
    }

    return { dl, canvasish, attrs, testids, messageCount: document.querySelectorAll('[data-message-author-role]').length };
  });

  say('');
  say(`messages currently in the DOM: ${report.messageCount}`);

  say('');
  say(`--- download affordances present right now: ${report.dl.length} ---`);
  for (const d of report.dl) {
    say(`  [${d.visible ? 'visible' : 'hidden '}] ${d.tag}  "${d.label}"  testid=${d.testid}`);
    say(`      ${d.selector}`);
  }

  say('');
  say(`--- canvas/artifact-looking elements: ${report.canvasish.length} ---`);
  for (const c of report.canvasish.slice(0, 30)) {
    say(`  ${c.tag}  testid=${c.testid || '-'}  id=${c.id || '-'}`);
    say(`      class=${c.cls}`);
  }

  say('');
  say('--- attributes suggesting artifact identity ---');
  for (const [k, v] of Object.entries(report.attrs).sort((a, b) => b[1] - a[1])) {
    say(`  ${v.toString().padStart(4)}  ${k}`);
  }

  say('');
  say('--- data-testid vocabulary (digits collapsed to N) ---');
  for (const [k, v] of Object.entries(report.testids).sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    say(`  ${v.toString().padStart(4)}  ${k}`);
  }

  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  say('');
  say(`written: ${OUT}`);
  // Deliberately no browser.close() — the operator owns that window.
}

main().catch((e) => {
  say('PROBE ERROR: ' + (e && e.stack ? e.stack : String(e)));
  try { fs.writeFileSync(OUT, lines.join('\n') + '\n'); } catch (_) {}
  process.exitCode = 1;
});
