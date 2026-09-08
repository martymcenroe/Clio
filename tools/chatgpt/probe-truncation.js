// Does a scroll that stops short admit it, on the REAL page? (#278)
//
//   CLIO_URL=https://chatgpt.com/c/<id> node tools/chatgpt/probe-truncation.js
//
// A capture of a 233-message conversation stopped after 2 scroll attempts, held
// 52 messages, and reported a success shape indistinguishable from the complete
// one. jsdom can reproduce that, but jsdom has no layout and no virtualized
// list, so a fix proved only there is a fix proved against a fixture. This runs
// the real extension code against the real DOM.
//
// The forced failure is faithful to the observed one: the scroller is pinned so
// that assignments to scrollTop do nothing, which is what "the scroller did not
// move" means on a page whose list re-anchors while a batch loads.
//
// A/B by default — the build at BASE_REF and the working tree, same page, same
// forced failure — because "the new build says stuck" only means something
// beside "the old build said fine".
//
// Read-only with respect to the conversation: it scrolls and reads. Never
// clicks, never navigates away, never closes the browser.

const { chromium } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const URL = process.env.CLIO_URL;
const REPO = path.resolve(__dirname, '..', '..');
const BASE_REF = process.env.CLIO_BASE_REF || 'origin/main';
const PINNED = Number(process.env.CLIO_PIN || 3000);
const NOPIN = process.env.CLIO_NOPIN === '1';
const OUT = path.join(os.homedir(), 'Projects', 'clio-harvest',
  process.env.CLIO_RUN || 'truncation-probe', 'truncation-probe.txt');

const lines = [];
const say = (s) => { lines.push(s); process.stdout.write(s + '\n'); };
function flush() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** content.js as of a git ref, or the working tree when ref is null. */
function contentSourceAt(ref, file) {
  if (!ref) return fs.readFileSync(path.join(REPO, file), 'utf8');
  return execFileSync('git', ['-C', REPO, 'show', `${ref}:${file}`],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

async function findPage(browser) {
  for (const c of browser.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com/.test(p.url())) return p;
  }
  return null;
}

/**
 * Wait until the conversation has actually rendered.
 *
 * A fixed sleep is not enough and failing it is silent in the worst way: with
 * no messages in the DOM, findScrollContainer() walks past the real scroll-root
 * and falls back to <body>, so the probe measures the wrong element and reports
 * a termination reason belonging to a different code path. The first run of
 * this probe did exactly that and produced a comparison that looked like a pass.
 */
async function waitForConversation(page, timeoutMs = 60000) {
  const started = Date.now();
  let last = 0;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => document.querySelectorAll(
      '[data-message-author-role="user"], [data-message-author-role="assistant"]').length);
    if (last > 0) {
      // Rendered, but the scroll-root may still be settling; let layout land.
      await sleep(2500);
      return last;
    }
    await sleep(1000);
  }
  return last;
}

/**
 * One run: reload, inject the given build, pin the scroller, scroll, report.
 *
 * The page is reloaded every time because content.js declares SCROLL_CONFIG
 * with `let` at top level. An indirect eval puts that in the global lexical
 * environment, where a second declaration is a SyntaxError — so two builds
 * cannot share one page load.
 */
async function runBuild(page, label, ref) {
  say(`\n=== ${label} (${ref || 'working tree'}) ===`);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  const rendered = await waitForConversation(page);
  if (rendered === 0) {
    say('  ABORT: the conversation never rendered — nothing to measure');
    return null;
  }

  await page.evaluate(() => {
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime ||
      { onMessage: { addListener: () => {} } };
  });

  for (const f of ['extensions/src/selectors-chatgpt.js', 'extensions/src/content.js']) {
    const src = contentSourceAt(ref, f);
    await page.evaluate((code) => { (0, eval)(code); }, src);
  }

  const ready = await page.evaluate(() => ({
    scroll: typeof window.scrollToLoadAllMessages === 'function',
    find: typeof window.findScrollContainer === 'function',
    messages: document.querySelectorAll(
      '[data-message-author-role="user"], [data-message-author-role="assistant"]').length
  }));
  say(`  injected: scroll=${ready.scroll} find=${ready.find}`);
  say(`  messages rendered before the walk: ${ready.messages}`);
  if (!ready.scroll) { say('  ABORT: injection failed'); return null; }

  // Pin the real scroller: writes to scrollTop are dropped, reads return a
  // fixed non-zero offset. This is the observed failure, not an invented one.
  //
  // With NOPIN the scroller is left alone and the walk runs for real, which is
  // the other half of the check: a fix that reports every capture incomplete
  // would pass the A/B above and be worse than the defect.
  const pinned = await page.evaluate(({ at, nopin }) => {
    const el = window.findScrollContainer();
    if (!el) return { ok: false };
    const before = { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
    if (!nopin) {
      Object.defineProperty(el, 'scrollTop', {
        get: () => at,
        set: () => { /* the scroll never takes effect */ },
        configurable: true
      });
    }
    return { ok: true, tag: el.tagName, cls: (el.className || '').slice(0, 40), before };
  }, { at: PINNED, nopin: NOPIN });
  if (!pinned.ok) { say('  ABORT: no scroll container'); return null; }
  if (pinned.tag.toLowerCase() === 'body') {
    // The fallback, which only happens when the real scroll-root was not found
    // — normally because the page had not finished rendering. Measuring it
    // would compare two different code paths and call the difference a fix.
    say('  ABORT: findScrollContainer fell back to <body>; the real scroller was not found');
    return null;
  }
  say(`  scroller: <${pinned.tag.toLowerCase()} class="${pinned.cls}">`);
  say(`  real offset ${Math.round(pinned.before.top)} of ${pinned.before.height}` +
      ` (viewport ${pinned.before.client}) — pinned at ${PINNED}`);

  await page.evaluate((s) => { window.__clioSettle = s; }, Number(process.env.CLIO_SETTLE || 6));
  const result = await page.evaluate(async (nopin) => {
    // Pinned: bound the run, since the ceiling path is a different termination
    // reason and is covered by unit tests; what matters there is the stuck one.
    // Unpinned: leave room for a real conversation to walk all the way up.
    window.setScrollConfig(nopin
      ? { maxScrollAttempts: 400, topSettleRounds: Number(window.__clioSettle || 6) }
      : { maxScrollAttempts: 12 });
    const t0 = Date.now();
    const r = await window.scrollToLoadAllMessages();
    return { ...r, ms: Date.now() - t0 };
  }, NOPIN);

  say(`  result: ${JSON.stringify({
    success: result.success,
    messagesLoaded: result.messagesLoaded,
    scrollAttempts: result.scrollAttempts,
    reachedTop: result.reachedTop,
    terminationReason: result.terminationReason,
    warning: result.warning ? result.warning.slice(0, 90) : undefined
  })}`);
  say(`  elapsed: ${result.ms}ms`);

  const admits = result.reachedTop === false ||
    /did not|missing|from the top/i.test(result.warning || '');
  say(`  DOES IT ADMIT THE WALK STOPPED SHORT?  ${admits ? 'YES' : 'NO'}`);
  flush();
  return { ...result, admits };
}

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page = await findPage(browser);
  if (!page) { say('no ChatGPT page attached — run open-session.js first'); flush(); return; }
  if (URL && !page.url().startsWith(URL)) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(9000);
  }
  say(`page: ${page.url()}`);

  if (NOPIN) {
    // The does-it-cry-wolf half. A real, unimpeded walk of a real conversation
    // must come back reachedTop: true, or the fix has simply replaced a flag
    // that was always false with one that is always true.
    say('NOPIN: running a real, unimpeded walk on the working tree');
    const run = await runBuild(page, 'REAL WALK', null);
    say('\n=== verdict ===');
    if (!run) { say('inconclusive: the run did not complete'); flush(); process.exitCode = 1; return; }
    say(`  attempts ${run.scrollAttempts}, messages ${run.messagesLoaded},` +
        ` reachedTop ${run.reachedTop}, reason ${run.terminationReason}`);
    if (run.reachedTop === true) {
      say('  PASS — a genuine full walk reports the top was reached; the check does not cry wolf.');
    } else {
      say('  FAIL — a genuine full walk did not report reaching the top.');
      process.exitCode = 1;
    }
    flush();
    say(`\nwrote ${OUT}`);
    return;
  }

  say(`forcing the scroller to be pinned at ${PINNED}px from the top`);

  const before = await runBuild(page, 'BEFORE', BASE_REF);
  const after = await runBuild(page, 'AFTER', null);

  say('\n=== verdict ===');
  if (!before || !after) { say('inconclusive: a run did not complete'); flush(); process.exitCode = 1; return; }
  say(`  ${BASE_REF}:   admits stopping short = ${before.admits}` +
      `  (attempts ${before.scrollAttempts}, reachedTop ${before.reachedTop})`);
  say(`  working tree: admits stopping short = ${after.admits}` +
      `  (attempts ${after.scrollAttempts}, reachedTop ${after.reachedTop})`);

  if (!before.admits && after.admits) {
    say('  PASS — the failure reproduced on the old build and is reported on the new one.');
  } else if (before.admits) {
    say('  UNEXPECTED — the old build already reported it; the reproduction is wrong.');
    process.exitCode = 1;
  } else {
    say('  FAIL — the new build still does not report a walk that stopped short.');
    process.exitCode = 1;
  }
  flush();
  say(`\nwrote ${OUT}`);
}

main().catch((e) => { say(`FAILED: ${e.message}`); flush(); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
