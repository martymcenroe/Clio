// Per-scroll accounting for a real capture: what arrives, when, and where the
// gaps are (#291).
//
//   CLIO_URL=https://chatgpt.com/c/<id> CLIO_RUN=<dir> node tools/chatgpt/probe-scroll-census.js
//
// Four captures of one conversation produced 227, 252, 250 and 243 messages,
// every one reporting contentComplete and reachedTop, at near-identical
// finalScrollHeight. Two mechanisms have been proposed and both measured false
// (id-less elements; add-and-evict inside one MutationObserver batch). A third
// guess would be worth less than an instrument.
//
// So this runs the REAL scrollToLoadAllMessages() — not a reimplementation —
// with captureRenderedMessages() wrapped to emit a sample on every call. Each
// sample is a fact about the real capture path:
//
//   when, scrollTop, scrollHeight, messages in the DOM, messages in the cache
//
// From that it derives the two things a guess cannot supply:
//
//   ARRIVAL LATENCY  how long after a scroll the next new message appears.
//                    If some batches land slower than the loop's patience, the
//                    walk is quitting into a gap and the fix is to wait longer.
//   GAP MAP          the captured messages sorted by their ordering key, with
//                    the distance between neighbours. A stretch of conversation
//                    that never loaded shows up as one abnormally large gap,
//                    which is what "where is the boundary" means concretely.
//
// Read-only apart from scrolling. Emits ids, counts and geometry; no message
// text leaves the page.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const URL = process.env.CLIO_URL;
const REPO = path.resolve(__dirname, '..', '..');
const RUN = process.env.CLIO_RUN || 'scroll-census';
const OUTDIR = path.join(os.homedir(), 'Projects', 'clio-harvest', RUN);

const lines = [];
const say = (s) => { lines.push(s); process.stdout.write(s + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForConversation(page, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const n = await page.evaluate(() => document.querySelectorAll(
      '[data-message-author-role="user"], [data-message-author-role="assistant"]').length);
    if (n > 0) { await sleep(2500); return n; }
    await sleep(1000);
  }
  return 0;
}

async function main() {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page = null;
  for (const c of b.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com/.test(p.url())) { page = p; break; }
    if (page) break;
  }
  if (!page) { say('no ChatGPT page attached — run open-session.js first'); return; }
  if (URL && !page.url().startsWith(URL)) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } else {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  if (!(await waitForConversation(page))) { say('conversation never rendered'); return; }
  say(`run:  ${RUN}`);
  say(`page: ${page.url()}`);

  await page.evaluate(() => {
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || { onMessage: { addListener: () => {} } };
  });
  for (const f of ['extensions/src/selectors-chatgpt.js', 'extensions/src/content.js']) {
    await page.evaluate((code) => { (0, eval)(code); },
      fs.readFileSync(path.join(REPO, f), 'utf8'));
  }

  // Wrap the real capture function. Every call it makes during the real walk
  // becomes a sample, so the timeline describes the shipped code path rather
  // than a copy of it.
  await page.evaluate(() => {
    const inner = window.captureRenderedMessages;
    const SEL = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
    window.__census = { samples: [], seen: {}, t0: Date.now() };

    window.captureRenderedMessages = function instrumented() {
      const added = inner.apply(this, arguments);
      const sc = window.__censusScroller;
      const c = window.__census;

      // Record a position for every id the first time it is seen. It is still
      // attached at this instant — that is how it was just captured — so it can
      // be measured. Waiting until the walk ends would be too late: nearly
      // everything is evicted by then, which is why the cache cannot answer
      // this and the probe has to.
      if (sc) {
        const sr = sc.getBoundingClientRect();
        for (const el of document.querySelectorAll(SEL)) {
          const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id');
          if (!id || c.seen[id]) continue;
          const r = el.getBoundingClientRect();
          const offsetTop = r.top - sr.top + sc.scrollTop;
          c.seen[id] = {
            t: Date.now() - c.t0,
            role: el.getAttribute('data-message-author-role'),
            fromBottom: sc.scrollHeight - offsetTop,
            atHeight: sc.scrollHeight
          };
        }
      }

      const stats = window.getCaptureOrderStats();
      c.samples.push({
        t: Date.now() - c.t0,
        top: sc ? Math.round(sc.scrollTop) : null,
        height: sc ? sc.scrollHeight : null,
        dom: document.querySelectorAll(SEL).length,
        cache: stats.captured,
        added
      });
      return added;
    };
  });

  // Resolve the scroller the way the extension does, and hold it for sampling.
  await page.evaluate(() => { window.__censusScroller = window.findScrollContainer(); });

  say('');
  say('walking (this is a full capture; several minutes)...');
  const t0 = Date.now();
  const result = await page.evaluate(async () => {
    const r = await window.scrollToLoadAllMessages();
    const stats = window.getCaptureOrderStats();
    // The ordering key per captured message, which is what a gap is measured in.
    const els = window.getCapturedMessageEls();
    const seen = window.__census.seen;
    const cache = els.map((el) => {
      const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id');
      const s = id && seen[id];
      return {
        id,
        role: el.getAttribute('data-message-author-role'),
        fromBottom: s ? s.fromBottom : null,
        firstSeenAt: s ? s.t : null
      };
    });
    return { r, stats, cache, samples: window.__census.samples };
  });
  const wall = Math.round((Date.now() - t0) / 1000);

  const { r, stats, cache, samples } = result;
  say(`done in ${wall}s: ${r.messagesLoaded} messages, ${r.scrollAttempts} attempts, ` +
      `reachedTop=${r.reachedTop}, reason=${r.terminationReason}`);
  say(`cache: ${stats.captured} captured, ${stats.withoutOrderKey} without an order key`);
  say('');

  // ---- ARRIVAL LATENCY -----------------------------------------------------
  // A "quiet stretch" is time during which the cache did not grow. If the
  // longest quiet stretch that was FOLLOWED by growth is close to the loop's
  // patience budget, the walk is quitting into a gap.
  const growth = [];
  let lastGrowT = 0, lastCache = samples.length ? samples[0].cache : 0;
  for (const s of samples) {
    if (s.cache > lastCache) {
      growth.push({ t: s.t, gapMs: s.t - lastGrowT, added: s.cache - lastCache, cache: s.cache });
      lastGrowT = s.t;
      lastCache = s.cache;
    }
  }
  const gaps = growth.map(g => g.gapMs).sort((a, b) => a - b);
  const pct = (p) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0;
  say('ARRIVAL LATENCY  (time between one new message and the next)');
  say(`  growth events: ${growth.length}`);
  say(`  median ${pct(0.5)}ms   p90 ${pct(0.9)}ms   p99 ${pct(0.99)}ms   max ${gaps[gaps.length - 1] || 0}ms`);
  const slow = growth.filter(g => g.gapMs >= 8000).sort((a, b) => b.gapMs - a.gapMs);
  say(`  waits of 8s or more that still produced content: ${slow.length}`);
  for (const g of slow.slice(0, 8)) {
    say(`    +${(g.t / 1000).toFixed(1)}s  after ${(g.gapMs / 1000).toFixed(1)}s of silence, ` +
        `${g.added} message(s) arrived (cache -> ${g.cache})`);
  }
  say('');

  // ---- SCROLL-STEP CENSUS --------------------------------------------------
  say('PER-SCROLL CENSUS  (samples where the scroller moved or the cache grew)');
  say('   time   scrollTop  scrollHeight   dom  cache  +new');
  let prev = null;
  for (const s of samples) {
    const moved = prev && s.top !== prev.top;
    const grew = prev && s.cache > prev.cache;
    if (prev && !moved && !grew) { prev = s; continue; }
    say(`  ${String((s.t / 1000).toFixed(1)).padStart(6)}s ${String(s.top).padStart(10)} ` +
        `${String(s.height).padStart(13)} ${String(s.dom).padStart(5)} ${String(s.cache).padStart(6)} ` +
        `${grew ? '+' + (s.cache - prev.cache) : ''}`);
    prev = s;
  }
  say('');

  // ---- GAP MAP -------------------------------------------------------------
  // Neighbour distance in the ordering key. The key is distance from the
  // scroller bottom, so consecutive messages normally differ by roughly one
  // message height. A stretch that never loaded is one abnormally large step.
  const withKey = cache.filter(c => typeof c.fromBottom === 'number');
  say('GAP MAP  (distance between neighbouring messages, in ordering-key units)');
  if (withKey.length < 3) {
    say('  ordering keys unavailable from the cache view; skipping');
  } else {
    const deltas = [];
    for (let i = 1; i < withKey.length; i++) {
      deltas.push({ i, d: Math.abs(withKey[i - 1].fromBottom - withKey[i].fromBottom),
                    a: withKey[i - 1].id, b: withKey[i].id });
    }
    const sorted = [...deltas].map(x => x.d).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 0;
    say(`  median neighbour distance: ${Math.round(med)}`);
    const big = deltas.filter(x => x.d > med * 6).sort((a, b) => b.d - a.d);
    say(`  gaps more than 6x the median: ${big.length}`);
    for (const g of big.slice(0, 10)) {
      say(`    at position ${g.i}: ${Math.round(g.d)}  between ${g.a} and ${g.b}`);
    }
  }

  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(path.join(OUTDIR, 'census.json'), JSON.stringify({
    run: RUN, result: r, stats, cache, samples
  }, null, 2));
  fs.writeFileSync(path.join(OUTDIR, 'census.txt'), lines.join('\n') + '\n');
  say('');
  say(`wrote ${path.join(OUTDIR, 'census.json')}`);
}

main().catch((e) => {
  say(`FAILED: ${e.message}`);
  try {
    fs.mkdirSync(OUTDIR, { recursive: true });
    fs.writeFileSync(path.join(OUTDIR, 'census.txt'), lines.join('\n') + '\n');
  } catch (_) { /* nothing more to do */ }
  process.exitCode = 1;
}).finally(() => process.exit(process.exitCode || 0));
