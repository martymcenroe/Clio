// Focused probe: how is a file/artifact card structured, and what control
// downloads it? Read-only, attaches over CDP to the open window. Never clicks,
// never navigates, never closes the browser.
//
//   node tools/chatgpt/probe-files.js
//
// Prints structure and filenames only — no document content.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(os.homedir(), 'Projects', 'clio-harvest', (process.env.CLIO_RUN || 'chatgpt-run'), 'file-probe.txt');
const lines = [];
const say = (s) => { lines.push(s); process.stdout.write(s + '\n'); };

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  let page = null;
  for (const c of browser.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com\/c\//.test(p.url())) { page = p; break; }
    if (page) break;
  }
  if (!page) { say('no ChatGPT conversation page attached'); return; }

  const report = await page.evaluate(() => {
    const desc = (el) => {
      const parts = [];
      let cur = el;
      while (cur && cur !== document.documentElement && parts.length < 6) {
        let s = cur.tagName.toLowerCase();
        if (cur.getAttribute && cur.getAttribute('data-testid')) s += `[${cur.getAttribute('data-testid')}]`;
        else if (cur.classList && cur.classList.length) s += '.' + [...cur.classList].slice(0, 2).join('.');
        parts.unshift(s);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    };

    const icons = [...document.querySelectorAll('[data-testid="library-file-icon"]')];
    const cards = [];
    for (const icon of icons.slice(0, 6)) {
      // Climb until the node looks like a self-contained card.
      let card = icon;
      for (let i = 0; i < 6 && card.parentElement; i++) {
        card = card.parentElement;
        if (card.innerText && card.innerText.trim().length > 3) break;
      }
      const msg = icon.closest('[data-message-author-role]');
      const turn = icon.closest('[data-testid^="conversation-turn"]');
      cards.push({
        iconPath: desc(icon),
        cardTag: card.tagName.toLowerCase(),
        cardTestid: card.getAttribute('data-testid'),
        cardClass: (typeof card.className === 'string' ? card.className : '').slice(0, 110),
        cardText: (card.innerText || '').trim().slice(0, 120).replace(/\n/g, ' | '),
        cardHtmlHead: card.outerHTML.slice(0, 300),
        inMessage: msg ? msg.getAttribute('data-message-id') : null,
        inTurn: turn ? turn.getAttribute('data-testid') : null,
        buttonsInCard: [...card.querySelectorAll('button, a')].map(b => ({
          label: (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 60),
          testid: b.getAttribute('data-testid'),
          href: b.getAttribute('href')
        })),
        clickableAncestor: (() => {
          let c = icon;
          while (c && c !== document.body) {
            if (c.tagName === 'BUTTON' || c.tagName === 'A' || c.getAttribute('role') === 'button') {
              return { tag: c.tagName.toLowerCase(), testid: c.getAttribute('data-testid'), label: (c.innerText || '').trim().slice(0, 60) };
            }
            c = c.parentElement;
          }
          return null;
        })()
      });
    }

    // How many file cards, and do they sit in assistant messages?
    let inAssistant = 0, inUser = 0, orphan = 0;
    for (const icon of icons) {
      const msg = icon.closest('[data-message-author-role]');
      if (!msg) orphan++;
      else if (msg.getAttribute('data-message-author-role') === 'assistant') inAssistant++;
      else inUser++;
    }

    return { total: icons.length, inAssistant, inUser, orphan, cards };
  });

  say(`file cards in the DOM: ${report.total}  (assistant ${report.inAssistant}, user ${report.inUser}, outside a message ${report.orphan})`);
  say('');
  for (const [i, c] of report.cards.entries()) {
    say(`--- card ${i + 1} ---`);
    say(`  icon at: ${c.iconPath}`);
    say(`  card:    <${c.cardTag}> testid=${c.cardTestid || '-'}`);
    say(`  class:   ${c.cardClass}`);
    say(`  text:    ${c.cardText}`);
    say(`  message: ${c.inMessage || '-'}   turn: ${c.inTurn || '-'}`);
    say(`  clickable ancestor: ${c.clickableAncestor ? JSON.stringify(c.clickableAncestor) : 'NONE'}`);
    say(`  buttons in card: ${c.buttonsInCard.length}`);
    for (const b of c.buttonsInCard) say(`      "${b.label}" testid=${b.testid || '-'} href=${b.href || '-'}`);
    say(`  html head: ${c.cardHtmlHead.replace(/\s+/g, ' ')}`);
    say('');
  }

  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  say(`written: ${OUT}`);
  // No browser.close() — the operator owns that window.
}

main().catch((e) => {
  say('PROBE ERROR: ' + (e && e.stack ? e.stack : String(e)));
  try { fs.writeFileSync(OUT, lines.join('\n') + '\n'); } catch (_) {}
  process.exitCode = 1;
});
