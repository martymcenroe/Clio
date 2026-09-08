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
  say(`other clickables inside assistant turns: ${found.otherClickablesTotal}` +
      (found.otherClickablesTotal > found.otherClickables.length
        ? ` (showing ${found.otherClickables.length})` : ''));

  // The backstop is printed whether or not the routes matched, because its
  // whole purpose is to be there when they are wrong (#321). An affordance
  // reading "Worked for 5m 34s" matched none of the original routes; if that
  // happens again with a wording nobody predicted, it shows up here.
  if (found.otherClickables.length) {
    say('');
    say('BACKSTOP -- clickables in assistant turns that no route matched.');
    say('If the reasoning affordance is not in the candidate list above, it is');
    say('almost certainly one of these, and the routes need widening.');
    for (const o of found.otherClickables) {
      say(`  clickable=${o.clickable}  label="${o.label}"`);
      say(renderChain(o.chain, 6));
    }
  }

  if (!found.candidates.length) {
    say('');
    say('No candidate matched a route. THIS IS NOT EVIDENCE THAT THE PAGE HAS NO');
    say('REASONING -- it is equally consistent with the routes being wrong, which');
    say('has already happened once: the first version of this probe matched only');
    say('reasoned/thought/thinking/reasoning and would have missed an affordance');
    say('reading "Worked for 5m 34s".');
    say('Read the backstop listing above before concluding anything. If the');
    say('affordance is in there, widen the routes in reasoning-dom.js. If the');
    say('backstop is empty too, try a conversation known to have used a reasoning');
    say('model.');
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

    // Candidate N here is candidate N in the report, because both come from
    // candidateElements(). The first version re-derived the list at click time
    // with a different filter, so the indexes agreed only by luck (#321).
    const measure = (idx) => {
      const els = window.ClioReasoningDom.candidateElements(document);
      const c = els[idx];
      if (!c) return { ok: false };
      const turn = c.el.closest('[data-message-author-role="assistant"]');
      return {
        ok: true,
        turnTextLen: turn ? turn.textContent.length : null,
        expanded: c.el.getAttribute('aria-expanded'),
        docTextLen: document.body.textContent.length
      };
    };

    const before = await page.evaluate(measure, i);
    if (!before.ok) { say('    (candidate no longer present -- skipped)'); continue; }

    await page.evaluate((idx) => {
      const els = window.ClioReasoningDom.candidateElements(document);
      if (els[idx]) els[idx].el.click();
    }, i);
    await sleep(SETTLE_MS);

    const after = await page.evaluate(measure, i);
    if (!after.ok) { say('    (candidate vanished after click)'); continue; }

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

main().catch((e) => { say(`FAILED: ${e && e.message}`); flush(); process.exit(1); }).finally(() => process.exit(process.exitCode || 0));
