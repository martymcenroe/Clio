// Capture every conversation on the account, once, and record what happened.
//
//   node tools/chatgpt/open-session.js          (once, leaves the window up)
//   node tools/chatgpt/sweep-account.js --run 1
//   node tools/chatgpt/sweep-account.js --run 2
//   node tools/chatgpt/sweep-account.js --run 3
//   node tools/chatgpt/compare-sweeps.js sweep-1 sweep-2 sweep-3
//
// Three runs, not one, because the question is whether the residual loss on
// #291 is a race or something structural, and only repetition separates them:
// a message missed in one run of three is a race, a message missed in all three
// is a different bug wearing the same symptom (#302).
//
// RESUMABLE. A conversation already captured for this run is skipped, so a
// sweep that dies at 40 of 60 continues rather than restarting. Every
// conversation is written the moment it completes; nothing is buffered.
//
// Never closes the browser and never navigates away at the end. The operator
// owns that window.
//
// OUTPUT NEVER GOES IN THE REPO. Clio is public and these are the operator's
// conversations (#250). The destination is asserted below, not merely defaulted.
//
// Options
//   --run <name>        run label; output lands in <harvest>/sweep-<name>/
//   --save-ids <file>   write the enumerated conversation ids and stop
//   --ids-file <file>   take the population from a file instead of the sidebar
//   --limit <n>         stop after n conversations (sizing a first pass)
//   --max-minutes <n>   stop when the wall clock passes n minutes
//   --per-conv-min <n>  give up on one conversation after n minutes (default 12)
//   --list              enumerate and print, capture nothing
//   --out <dir>         override the harvest root
//
// Pin the population with --save-ids once, then --ids-file for all three runs
// (#305). The sidebar is not stable between visits -- three enumerations of one
// account returned 115, 227 and 340 -- and runs over different populations
// cannot be differenced.
//
// THE FULL POPULATION, EVERY RUN. There is deliberately no sampling flag (#304).
// The measurement is not an average loss rate, which would survive a subset
// comfortably; it is the size of the all-missed bucket, which at a ~4% rate over
// three runs is p^3 -- a handful of messages out of tens of thousands. Shrink
// the population and that bucket falls below one, at which point a systematic
// cause and a pure race produce the same observation and the experiment answers
// nothing. The rare bucket IS the signal, and sampling is the one operation that
// destroys it.
//
// --limit and --max-minutes bound a SESSION, not the population. The sweep is
// resumable, so time-boxed chunks converge on the same complete result: that is
// interruption, not selection.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.CLIO_PORT || 9333);

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : (process.argv[i + 1] || dflt);
}
const has = (name) => process.argv.includes(`--${name}`);

const RUN = String(arg('run', '1'));
const LIMIT = Number(arg('limit', 0));
const MAX_MINUTES = Number(arg('max-minutes', 0));
const PER_CONV_MIN = Number(arg('per-conv-min', 12));
const HARVEST = arg('out', path.join(os.homedir(), 'Projects', 'clio-harvest'));
const OUTDIR = path.join(HARVEST, `sweep-${RUN}`);

const say = (s) => process.stdout.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Refuse to write inside ANY git working tree.
 *
 * Defaulting elsewhere is not enough: a mistyped --out would put an account's
 * worth of private conversations into a public repo's working tree, where the
 * next `git add -A` finds them. So the destination is checked and a bad one
 * stops the program rather than being quietly corrected.
 *
 * Checking only against THIS file's repo is not enough either, and that version
 * failed its own test: run from a worktree it happily accepted a path inside the
 * main checkout, because the two are different directories. The property that
 * matters is "somewhere git tracks", not "somewhere near me", so the walk looks
 * for a .git entry above the destination. A worktree's .git is a file rather
 * than a directory, hence existsSync rather than a directory test.
 */
function assertOutsideRepo(dir) {
  let cur = path.resolve(dir);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(cur, '.git'))) {
      say(`REFUSING to write inside a git working tree: ${dir}`);
      say(`  (found ${path.join(cur, '.git')})`);
      say('These are conversation exports and Clio is public. Choose a path outside any repo.');
      process.exit(2);
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
}

async function findPage(browser) {
  for (const c of browser.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com/.test(p.url())) return p;
  }
  return null;
}

/** Every conversation in the sidebar, scrolling it until it stops growing. */
async function enumerateConversations(page) {
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);

  // Require the count to hold steady several rounds running. A single stable
  // reading is not enough: the sidebar pages in lazily and pauses, and taking
  // the first plateau as the end found 115 conversations on one attempt and 227
  // on another. A population that changes between runs would wreck the
  // comparison, which is why --save-ids exists.
  let previous = -1;
  let stable = 0;
  for (let round = 0; round < 200; round++) {
    const count = await page.evaluate(() => {
      // The sidebar is its own scroller; find the one holding /c/ links.
      const link = document.querySelector('a[href^="/c/"]');
      let el = link;
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event('scroll', { bubbles: true }));
          break;
        }
        el = el.parentElement;
      }
      return document.querySelectorAll('a[href^="/c/"]').length;
    });
    if (count === previous) {
      if (++stable >= 6) break;
    } else {
      stable = 0;
      previous = count;
    }
    await sleep(1800);
  }

  return page.evaluate(() => {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href^="/c/"]')) {
      const id = (a.getAttribute('href') || '').split('/c/')[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      // The title is the operator's own text; kept only so a report is readable
      // and truncated because it is conversation content.
      out.push({ id, title: (a.innerText || '').trim().slice(0, 60) });
    }
    return out;
  });
}

async function captureOne(page, conv, sources) {
  const started = Date.now();
  await page.goto(`https://chatgpt.com/c/${conv.id}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for the conversation to render. Injecting before it does makes
  // findScrollContainer fall back to <body>, which silently measures the wrong
  // element -- a mistake already made once by hand.
  let rendered = 0;
  for (let i = 0; i < 45; i++) {
    rendered = await page.evaluate(() => document.querySelectorAll(
      '[data-message-author-role="user"], [data-message-author-role="assistant"]').length);
    if (rendered > 0) break;
    await sleep(1000);
  }
  if (!rendered) return { ok: false, reason: 'never rendered' };
  await sleep(2000);

  await page.evaluate(() => {
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || { onMessage: { addListener: () => {} } };
  });
  for (const src of sources) {
    await page.evaluate((code) => { (0, eval)(code); }, src);
  }

  const out = await page.evaluate(async () => {
    const r = await window.extractConversation();
    return r.success ? { ok: true, data: r.data } : { ok: false, reason: r.error };
  });
  if (!out.ok) return out;

  out.elapsedMs = Date.now() - started;
  return out;
}

async function main() {
  assertOutsideRepo(OUTDIR);
  fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const page = await findPage(browser);
  if (!page) {
    say('No ChatGPT page attached. Run: node tools/chatgpt/open-session.js');
    process.exit(1);
  }

  say(`run:    ${RUN}`);
  say(`output: ${OUTDIR}`);

  // A fixed population is what makes the three runs comparable. Enumerate once,
  // save the list, and point every run at it: the sidebar itself is not stable
  // between visits, and a run that saw a different set of conversations cannot
  // be differenced against one that saw another.
  let convs;
  const IDS_FILE = arg('ids-file', null);
  if (IDS_FILE) {
    convs = fs.readFileSync(IDS_FILE, 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => ({ id: l.split(/\s+/)[0], title: '' }));
    say(`population: ${convs.length} conversation(s) from ${IDS_FILE}`);
  } else {
    say('enumerating conversations...');
    convs = await enumerateConversations(page);
    say(`found ${convs.length} conversation(s)`);
  }

  const SAVE_IDS = arg('save-ids', null);
  if (SAVE_IDS) {
    assertOutsideRepo(path.dirname(SAVE_IDS));
    fs.writeFileSync(SAVE_IDS, convs.map(c => c.id).join('\n') + '\n');
    say(`wrote ${convs.length} id(s) to ${SAVE_IDS}`);
  }

  if (has('list')) {
    for (const c of convs) say(`  ${c.id}  ${c.title}`);
    return;
  }

  // Read verbatim, once, so every conversation is captured by identical code.
  const sources = ['extensions/src/selectors-chatgpt.js', 'extensions/src/content.js']
    .map(f => fs.readFileSync(path.join(REPO, f), 'utf8'));

  const manifestPath = path.join(OUTDIR, 'manifest.jsonl');
  const done = new Set();
  if (fs.existsSync(manifestPath)) {
    for (const line of fs.readFileSync(manifestPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).id); } catch (e) { /* skip a torn line */ }
    }
    say(`resuming: ${done.size} already captured in this run`);
  }

  const startedAll = Date.now();
  let n = 0, captured = 0, failed = 0;

  for (const conv of convs) {
    if (done.has(conv.id)) continue;
    if (LIMIT && captured >= LIMIT) { say('--limit reached'); break; }
    if (MAX_MINUTES && (Date.now() - startedAll) / 60000 >= MAX_MINUTES) {
      say('--max-minutes reached'); break;
    }
    n++;

    let res;
    try {
      res = await Promise.race([
        captureOne(page, conv, sources),
        sleep(PER_CONV_MIN * 60000).then(() => ({ ok: false, reason: 'per-conversation timeout' }))
      ]);
    } catch (e) {
      res = { ok: false, reason: String(e.message || e).slice(0, 120) };
    }

    if (!res.ok) {
      failed++;
      say(`  [${n}/${convs.length}] ${conv.id.slice(0, 8)}  FAILED: ${res.reason}`);
      fs.appendFileSync(manifestPath,
        JSON.stringify({ id: conv.id, ok: false, reason: res.reason, at: new Date().toISOString() }) + '\n');
      continue;
    }

    const md = res.data.metadata;
    // The full export, which is the actual output under test.
    fs.writeFileSync(path.join(OUTDIR, `${conv.id}.json`), JSON.stringify(res.data, null, 2));
    // And a compact row, so the comparison never has to open every export.
    fs.appendFileSync(manifestPath, JSON.stringify({
      id: conv.id,
      ok: true,
      at: new Date().toISOString(),
      elapsedMs: res.elapsedMs,
      messageCount: md.messageCount,
      contentComplete: md.contentComplete,
      incompleteReasons: md.incompleteReasons,
      decorationSkipped: md.decorationSkipped,
      extractionErrors: md.extractionErrors.length,
      mediaErrors: md.mediaErrors.length,
      scrollInfo: md.scrollInfo,
      orderInfo: md.orderInfo || null,
      messageIds: res.data.messages.map(m => m.id)
    }) + '\n');

    captured++;
    say(`  [${n}/${convs.length}] ${conv.id.slice(0, 8)}  ${String(md.messageCount).padStart(4)} messages  ` +
        `${Math.round(res.elapsedMs / 1000)}s  complete=${md.contentComplete}`);
  }

  say('');
  say(`captured ${captured}, failed ${failed}, in ${Math.round((Date.now() - startedAll) / 60000)} minute(s)`);
  say(`manifest: ${manifestPath}`);
  say('The browser is left exactly as it was found.');
}

main().catch((e) => { say(`FAILED: ${e.message}`); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
