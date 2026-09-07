// Is ChatGPT's reasoning content reachable at all? (#317, for #316)
//
//   node tools/chatgpt/probe-reasoning.js
//   CLIO_URL=https://chatgpt.com/c/<id> node tools/chatgpt/probe-reasoning.js
//
// #316 records that 5,644 captured messages carry an empty `thinking` field,
// because selectors-chatgpt.js sets thinkingToggle and thinkingContent to null
// and expandAllContent() therefore clicks nothing. Before a selector can be
// written, one question has to be answered on the real page:
//
//   IS THE REASONING TEXT ALREADY IN THE DOM, OR DOES IT ARRIVE ON CLICK?
//
// The answer decides the shape of the fix. If the collapse is CSS-only, a
// selector is enough and nothing needs clicking — which is what turned out to be
// true of ChatGPT's "show more" on long USER messages, measured across 2,662
// captured messages showing no length ceiling and a smooth tail to 57,252
// characters. That result is about user messages and is deliberately NOT assumed
// to hold for reasoning blocks; assuming it is how the wrong selector ships.
//
// So this measures rather than assumes: find the affordance, record the text
// length of its region, click it, wait, record the length again.
//
// Attaches to the window already open on port 9333. Never launches a browser,
// never closes one, never navigates away at the end. It DOES click reasoning
// affordances and it DOES navigate when CLIO_URL is given, which is why it
// should not be run against a window that is mid-sweep: a second page load
// against the same account can perturb a run in progress (#302, #304).
//
// Counts, tags and lengths only -- never conversation text. Output goes to
// clio-harvest, outside this public repo (#250).

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const URL = process.env.CLIO_URL;
const SETTLE_MS = Number(process.env.CLIO_SETTLE_MS || 1500);
const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(os.homedir(), 'Projects', 'clio-harvest',
  (process.env.CLIO_RUN || 'reasoning-probe'), 'reasoning.txt');

const out = [];
const say = (s) => { out.push(s); process.stdout.write(s + '\n'); };
function flush() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out.join('\n') + '\n');
  process.stdout.write(`\nwrote ${OUT}\n`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage(browser) {
  for (const c of browser.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com/.test(p.url())) return p;
  }
  return null;
}

/**
 * Wait for assistant turns to exist.
 *
 * Injecting before the conversation renders measures an empty document and
 * reports "no reasoning found", which is indistinguishable from the real
 * negative result this probe exists to establish. That confusion has already
 * cost a probe run once (see probe-truncation.js).
 */
async function waitForRender(page) {
  for (let i = 0; i < 45; i++) {
    const n = await page.evaluate(() => document.querySelectorAll(
      '[data-message-author-role="assistant"]').length);
    if (n > 0) return n;
    await sleep(1000);
  }
  return 0;
}

function renderChain(chain, indent) {
  const pad = ' '.repeat(indent);
  return chain.map((d, i) => {
    const cls = d.classes ? ` .${d.classes.split(/\s+/).slice(0, 4).join('.')}` : '';
    const attrs = Object.keys(d.attrs).length
      ? '  ' + Object.entries(d.attrs).map(([k, v]) => `${k}="${v}"`).join(' ') : '';
    return `${pad}${i === 0 ? '->' : '  '} <${d.tag}>${cls}${attrs}\n` +
           `${pad}     overflowY=${d.overflowY} maxHeight=${d.maxHeight} ` +
           `scroll=${d.scrollHeight}/${d.clientHeight}` +
           `${d.clipped ? ' CLIPPED' : ''} textLen=${d.textLength}`;
  }).join('\n');
}

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const page = await findPage(browser);
  if (!page) {
    say('no ChatGPT page attached -- run: node tools/chatgpt/open-session.js');
    flush();
    return;
  }

  if (URL && !page.url().startsWith(URL)) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  const turns = await waitForRender(page);
  say(`page:            ${page.url()}`);
  say(`assistant turns: ${turns}`);
  if (!turns) {
    say('');
    say('Nothing rendered. This is NOT evidence that reasoning is absent -- the');
    say('conversation did not load. Re-run against a conversation that renders.');
    flush();
    return;
  }

  // Injected as source text so the discovery logic is a real module that jsdom
  // can exercise, rather than a closure only this probe can reach.
  const src = fs.readFileSync(
    path.join(REPO, 'tools', 'chatgpt', 'reasoning-dom.js'), 'utf8');
  await page.evaluate((code) => { (0, eval)(code); }, src);

  const found = await page.evaluate(() =>
    window.ClioReasoningDom.findReasoningCandidates(document));

  say('');
  say(`reasoning candidates: ${found.candidates.length}`);
  if (!found.candidates.length) {
    say('');
    say('No affordance found on this conversation. Two readings, and this probe');
    say('cannot separate them from one page: the conversation used a model that');
    say('emits no reasoning, or the markup no longer matches either route (a');
    say('label starting "Reasoned"/"Thought", or a data-testid/aria-label naming');
    say('reasoning). Try a conversation known to have used a reasoning model');
    say('before concluding anything about the selectors.');
    flush();
    return;
  }

  // THE MEASUREMENT. Everything above is discovery; this is the part that
  // decides whether the fix needs to click.
  say('');
  say('BEFORE / AFTER CLICK  (does the text already exist, or arrive on click?)');
  for (let i = 0; i < found.candidates.length; i++) {
    const c = found.candidates[i];
    say('');
    say(`[${i}] foundBy=${c.foundBy} clickable=${c.clickable} ` +
        `insideAssistantTurn=${c.insideAssistantTurn}  label="${c.label}"`);
    say(renderChain(c.chain, 4));

    if (!c.clickable) { say('    (not clickable -- not clicked)'); continue; }

    const before = await page.evaluate((idx) => {
      const f = window.ClioReasoningDom.findReasoningCandidates(document);
      const els = document.querySelectorAll('button, [role="button"], [aria-expanded]');
      let n = 0;
      for (const el of els) {
        if (!window.ClioReasoningDom.LABEL.test(el.textContent || '')) continue;
        if (n++ !== idx) continue;
        const turn = el.closest('[data-message-author-role="assistant"]');
        return {
          turnTextLen: turn ? turn.textContent.length : null,
          expanded: el.getAttribute('aria-expanded'),
          docTextLen: document.body.textContent.length,
          ok: true
        };
      }
      return { ok: false, seen: f.candidates.length };
    }, i);

    if (!before.ok) { say('    (candidate no longer present -- skipped)'); continue; }

    await page.evaluate((idx) => {
      const els = document.querySelectorAll('button, [role="button"], [aria-expanded]');
      let n = 0;
      for (const el of els) {
        if (!window.ClioReasoningDom.LABEL.test(el.textContent || '')) continue;
        if (n++ !== idx) continue;
        el.click();
        return;
      }
    }, i);
    await sleep(SETTLE_MS);

    const after = await page.evaluate((idx) => {
      const els = document.querySelectorAll('button, [role="button"], [aria-expanded]');
      let n = 0;
      for (const el of els) {
        if (!window.ClioReasoningDom.LABEL.test(el.textContent || '')) continue;
        if (n++ !== idx) continue;
        const turn = el.closest('[data-message-author-role="assistant"]');
        return {
          turnTextLen: turn ? turn.textContent.length : null,
          expanded: el.getAttribute('aria-expanded'),
          docTextLen: document.body.textContent.length
        };
      }
      return null;
    }, i);

    if (!after) { say('    (candidate vanished after click)'); continue; }
    const dTurn = (after.turnTextLen || 0) - (before.turnTextLen || 0);
    const dDoc = after.docTextLen - before.docTextLen;
    say(`    aria-expanded ${before.expanded} -> ${after.expanded}`);
    say(`    assistant turn textLength ${before.turnTextLen} -> ${after.turnTextLen}  (${dTurn >= 0 ? '+' : ''}${dTurn})`);
    say(`    document textLength       ${before.docTextLen} -> ${after.docTextLen}  (${dDoc >= 0 ? '+' : ''}${dDoc})`);
    say(dTurn > 0 || dDoc > 0
      ? '    => TEXT ARRIVES ON CLICK. A selector alone is not enough; the'
        + '\n       capture has to click the affordance and wait for it.'
      : '    => no new text. Either the reasoning was already in the DOM (a'
        + '\n       CSS-only collapse, selector alone suffices) or the click did'
        + '\n       nothing. The chain above says which: look for CLIPPED.');
  }

  say('');
  say('Read the chain for the element that actually holds the reasoning text,');
  say('and take the selector from THAT, not from the button. #316 is where the');
  say('selector lands.');
  flush();
}

main().catch((e) => { say(`FAILED: ${e && e.message}`); flush(); process.exit(1); });
