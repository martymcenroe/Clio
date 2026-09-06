// What ordering signal does a rendered ChatGPT window actually carry?
//
//   node tools/chatgpt/probe-order.js
//
// Two hypotheses have now failed: conversation-turn-N as a global index, and
// DOM order within a window. Before trying a third, measure. Read-only over
// CDP; never clicks, never navigates, never closes the browser.
//
// For every message currently rendered this prints DOM index, the turn testid,
// and visual top, then answers directly: does DOM order match visual order, and
// are the turn numbers globally unique?

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(os.homedir(), 'Projects', 'clio-harvest', (process.env.CLIO_RUN || 'chatgpt-run'), 'order-probe.txt');
const lines = [];
const say = (s) => { lines.push(s); process.stdout.write(s + '\n'); };

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CLIO_CDP || 'http://127.0.0.1:9333');
  let page = null;
  for (const c of browser.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com\/c\//.test(p.url())) { page = p; break; }
    if (page) break;
  }
  if (!page) { say('no ChatGPT conversation page attached'); return; }

  const r = await page.evaluate(() => {
    const sel = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
    const nodes = [...document.querySelectorAll(sel)];
    const rows = nodes.map((el, i) => {
      const turnEl = el.closest('[data-testid^="conversation-turn"]');
      const testid = turnEl ? turnEl.getAttribute('data-testid') : null;
      const rect = el.getBoundingClientRect();
      return {
        domIndex: i,
        id: (el.getAttribute('data-message-id') || '').slice(0, 8),
        role: el.getAttribute('data-message-author-role'),
        testid,
        turnNum: testid ? Number((testid.match(/(\d+)\s*$/) || [])[1]) : null,
        top: Math.round(rect.top),
        height: Math.round(rect.height),
        head: (el.innerText || '').trim().slice(0, 40).replace(/\n/g, ' ')
      };
    });

    // Every attribute anywhere on a turn wrapper — maybe an absolute index
    // exists that nothing has looked at yet.
    const wrapperAttrs = {};
    for (const w of document.querySelectorAll('[data-testid^="conversation-turn"]')) {
      for (const a of w.attributes) wrapperAttrs[a.name] = (wrapperAttrs[a.name] || 0) + 1;
    }
    // And on the message element itself.
    const msgAttrs = {};
    for (const el of nodes) {
      for (const a of el.attributes) msgAttrs[a.name] = (msgAttrs[a.name] || 0) + 1;
    }

    // Does the scroller position items absolutely (i.e. is DOM order free)?
    const scroller = (() => {
      let best = null, bestN = -1;
      for (const el of document.querySelectorAll('*')) {
        const st = getComputedStyle(el);
        if ((st.overflowY === 'auto' || st.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 100) {
          const n = el.querySelectorAll(sel).length;
          if (n > bestN) { bestN = n; best = el; }
        }
      }
      return best;
    })();
    const positioned = nodes.slice(0, 8).map(el => {
      const p = el.closest('[data-testid^="conversation-turn"]') || el;
      return getComputedStyle(p).position;
    });

    return {
      rows, wrapperAttrs, msgAttrs, positioned,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      scrollHeight: scroller ? scroller.scrollHeight : null
    };
  });

  say(`messages rendered: ${r.rows.length}   scrollTop ${r.scrollTop} of ${r.scrollHeight}`);
  say(`turn-wrapper CSS position (first 8): ${r.positioned.join(', ')}`);
  say('');

  say('domIdx  turn      top     role       id        head');
  for (const row of r.rows) {
    say(`${String(row.domIndex).padStart(5)}  ${String(row.turnNum ?? '-').padStart(4)}  ${String(row.top).padStart(7)}  ${row.role.padEnd(9)}  ${row.id}  ${row.head}`);
  }
  say('');

  // Q1: is DOM order the same as visual order?
  const byTop = [...r.rows].sort((a, b) => a.top - b.top).map(x => x.domIndex);
  const inOrder = byTop.every((v, i) => v === i);
  say(`Q1  DOM order == visual (top-to-bottom) order?  ${inOrder ? 'YES' : 'NO'}`);
  if (!inOrder) say(`     visual order by DOM index: ${byTop.join(', ')}`);

  // Q2: are turn numbers unique and monotonic with visual order?
  const turns = r.rows.map(x => x.turnNum).filter(n => Number.isFinite(n));
  const uniq = new Set(turns);
  say(`Q2  turn numbers: ${turns.length} present, ${uniq.size} distinct, range ${Math.min(...turns)}..${Math.max(...turns)}`);
  const visualTurns = [...r.rows].sort((a, b) => a.top - b.top).map(x => x.turnNum);
  let monotonic = true;
  for (let i = 1; i < visualTurns.length; i++) {
    if (Number.isFinite(visualTurns[i]) && Number.isFinite(visualTurns[i - 1]) && visualTurns[i] < visualTurns[i - 1]) { monotonic = false; break; }
  }
  say(`     non-decreasing in visual order? ${monotonic ? 'YES' : 'NO'}`);

  say('');
  say('attributes on turn wrappers:');
  for (const [k, v] of Object.entries(r.wrapperAttrs).sort((a, b) => b[1] - a[1])) say(`  ${String(v).padStart(4)}  ${k}`);
  say('attributes on message elements:');
  for (const [k, v] of Object.entries(r.msgAttrs).sort((a, b) => b[1] - a[1])) say(`  ${String(v).padStart(4)}  ${k}`);

  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  say(`\nwritten: ${OUT}`);
}

main().catch((e) => {
  say('PROBE ERROR: ' + (e && e.stack ? e.stack : String(e)));
  try { fs.writeFileSync(OUT, lines.join('\n') + '\n'); } catch (_) {}
  process.exitCode = 1;
});
