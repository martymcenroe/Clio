// ChatGPT harvest, run 3 — messages + artifacts, captured DURING the scroll.
//
//   node tools/chatgpt/harvest.js
//
// Attaches over CDP to the window already open on port 9333, so nothing has to
// be closed and no one has to sign in. Reloads the conversation to reset the
// virtualized window, then scrolls back to the first message.
//
// What run 2 got wrong and this fixes (#262): it collected download
// affordances AFTER the scroll, by which time virtualization had evicted every
// button belonging to the rest of the thread — result, zero artifacts. Capture
// now happens on every round, exactly as message capture does (#256).
//
// Two artifact classes, established by probing the live DOM:
//
//   uploaded files    [data-testid="library-file-icon"] cards, all in USER
//                     messages. Display-only: no button, no link, no clickable
//                     ancestor. Their NAME and TYPE are recoverable; contents
//                     are not, from the transcript alone.
//   generated files   real "Download <name>" buttons on assistant output.
//                     These are clickable and are what actually yields a file.
//
// Structure, names and counts to the log; conversation content and files go to
// clio-harvest, OUTSIDE this public repo (#250/#251).
// NEVER closes the browser — the operator owns that window.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CDP = process.env.CLIO_CDP || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(os.homedir(), 'Projects', 'clio-harvest', (process.env.CLIO_RUN || 'chatgpt-run'));
const ART_DIR = path.join(OUT_DIR, 'artifacts');
const CODE_DIR = path.join(OUT_DIR, 'code');
const CONV_URL = process.env.CLIO_URL;

const MSG_SEL = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
const FIRST_MESSAGE_MARKER = process.env.CLIO_FIRST || '';

const GROWTH_WAIT_MS = Number(process.env.CLIO_GROWTH_WAIT_MS || 200000);
const QUIET_LIMIT_MS = Number(process.env.CLIO_QUIET_LIMIT_MS || 900000);
const MAX_MS = Number(process.env.CLIO_MAX_MS || 240 * 60 * 1000);

const log = [];
const say = (s) => { log.push(s); process.stdout.write(s + '\n'); };
function flush() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'harvest3.log'), log.join('\n') + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (s) => (s || 'untitled').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);

const EXT = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
  bash: 'sh', shell: 'sh', sh: 'sh', powershell: 'ps1', json: 'json',
  yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css', sql: 'sql',
  markdown: 'md', md: 'md', text: 'txt', diff: 'diff', xml: 'xml'
};

async function main() {
  if (!CONV_URL) {
    process.stderr.write(
      'CLIO_URL is required: the full https://chatgpt.com/c/<id> URL to harvest.\n' +
      'Set CLIO_FIRST too — a distinctive phrase from the conversation\'s first\n' +
      'message — or the scroll cannot tell when it has reached the beginning and\n' +
      'will run until the quiet limit.\n');
    process.exitCode = 2;
    return;
  }
  if (!FIRST_MESSAGE_MARKER) {
    say('NOTE: CLIO_FIRST is not set, so this run cannot detect the first message.');
    say('      It will scroll until nothing new appears for the quiet limit.');
  }
  for (const d of [OUT_DIR, ART_DIR, CODE_DIR]) fs.mkdirSync(d, { recursive: true });

  say('=== ChatGPT harvest — artifacts captured during the scroll ===');
  say(`attaching over CDP at ${CDP} (nothing to close, no sign-in)`);
  flush();

  const browser = await chromium.connectOverCDP(CDP);
  let page = null;
  for (const c of browser.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com/.test(p.url())) { page = p; break; }
    if (page) break;
  }
  if (!page) { say('no ChatGPT page on the attached browser — is the window still open?'); flush(); return; }

  const downloads = [];
  page.on('download', async (d) => {
    try {
      const name = safe(d.suggestedFilename());
      const dest = path.join(ART_DIR, name);
      await d.saveAs(dest);
      const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      downloads.push({ name, path: dest, bytes: size });
      say(`    saved artifact: ${name} (${size} bytes)`);
      flush();
    } catch (e) {
      say(`    download failed: ${String(e.message || e).slice(0, 140)}`);
      flush();
    }
  });

  // Reload so the virtualized window starts at the bottom again.
  say('reloading the conversation to reset the virtualized window...');
  flush();
  await page.goto(CONV_URL, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, MSG_SEL);
    if (n >= 1) break;
    await sleep(2000);
  }

  await page.evaluate(([sel, marker]) => {
    const w = window;
    w.__clio = { store: new Map(), files: new Map(), seenDl: new Set(), maxAtOnce: 0, foundFirst: false, seq: 0 };

    const grabFiles = (msgEl, msgId, turn) => {
      for (const icon of msgEl.querySelectorAll('[data-testid="library-file-icon"]')) {
        let card = icon;
        for (let i = 0; i < 6 && card.parentElement; i++) {
          card = card.parentElement;
          if (card.innerText && card.innerText.trim().length > 3) break;
        }
        const text = (card.innerText || '').trim();
        const [name, kind] = text.split('\n').map(s => s.trim());
        const key = `${msgId}::${name}`;
        if (name && !w.__clio.files.has(key)) {
          w.__clio.files.set(key, { name, kind: kind || null, messageId: msgId, turn });
        }
      }
    };

    const grab = (el) => {
      const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id');
      if (!id || w.__clio.store.has(id)) return false;
      const turnEl = el.closest('[data-testid^="conversation-turn"]');
      const tm = turnEl ? (turnEl.getAttribute('data-testid') || '').match(/(\d+)\s*$/) : null;
      const turn = tm ? parseInt(tm[1], 10) : Number.MAX_SAFE_INTEGER;

      const codes = [];
      for (const pre of el.querySelectorAll('pre')) {
        const codeEl = pre.querySelector('code') || pre;
        // Highlighter class first, header text only as a fallback, and only
        // when the header reduces to a single token (#263).
        let lang = null;
        const cls = [...(codeEl.classList || []), ...(pre.classList || [])];
        for (const c of cls) {
          const m = c.match(/^(?:language|lang|highlight)[-_](.+)$/i);
          if (m) { lang = m[1].toLowerCase(); break; }
        }
        if (!lang) {
          const head = pre.querySelector('[class*="sticky"], header');
          if (head) {
            const noise = new Set(['copy', 'copied', 'edit', 'run', 'share', 'download',
              'expand', 'collapse', 'wrap', 'preview', 'code', 'always', 'show', 'details']);
            const toks = (head.textContent || '').trim().split(/\s+/)
              .map(t => t.toLowerCase()).filter(t => t && !noise.has(t));
            if (toks.length === 1) lang = toks[0];
          }
        }
        codes.push({ language: lang, code: codeEl.innerText });
      }

      // Ordering key that survives lazy loading.
      //
      // conversation-turn-N is NOT usable at capture time: it is provisional
      // while the conversation is still loading (observed 1..14 during a scroll,
      // 1..288 once fully loaded), so a message captured early carries a stale
      // small number.
      //
      // Distance from the BOTTOM of the scroller is invariant instead.
      // Prepending older content above increases scrollHeight by D and pushes
      // every existing element's offset down by the same D, so
      // (scrollHeight - offsetTop) does not move. Larger = older = earlier.
      let fromBottom = null;
      const sc = w.__clioScroller && w.__clioScroller();
      if (sc) {
        const r = el.getBoundingClientRect();
        const sr = sc.getBoundingClientRect();
        const offsetTop = r.top - sr.top + sc.scrollTop;
        fromBottom = sc.scrollHeight - offsetTop;
      }

      const text = el.innerText || '';
      w.__clio.store.set(id, {
        id, turn, seq: w.__clio.seq++, fromBottom,
        role: el.getAttribute('data-message-author-role'),
        model: el.getAttribute('data-message-model-slug') || null,
        text, codeBlocks: codes
      });
      grabFiles(el, id, turn);
      // Only when a marker was actually supplied. An empty marker matches every
      // message, which would set foundFirst on the opening sweep and stop the
      // scroll after one round while reporting it had reached the beginning.
      if (marker && text.toLowerCase().includes(marker.toLowerCase())) {
        w.__clio.foundFirst = true;
      }
      return true;
    };

    // Global ordering by STITCHING overlapping windows.
    //
    // data-testid="conversation-turn-N" is numbered relative to the rendered
    // window, not the conversation — across 155 messages it took only 14
    // distinct values, so sorting by it scrambles the transcript. What IS
    // reliable is DOM order WITHIN a window, plus the fact that consecutive
    // windows overlap. So splice each window into a global list, anchoring on
    // the ids already placed.
    w.__clio.order = [];
    const stitch = (windowIds) => {
      const order = w.__clio.order;
      const pos = new Map(order.map((id, i) => [id, i]));
      for (let i = 0; i < windowIds.length; i++) {
        const id = windowIds[i];
        if (pos.has(id)) continue;
        // Nearest already-placed neighbour AFTER this one: insert before it.
        let at = -1;
        for (let j = i + 1; j < windowIds.length; j++) {
          if (pos.has(windowIds[j])) { at = pos.get(windowIds[j]); break; }
        }
        if (at === -1) {
          // Else nearest already-placed neighbour BEFORE: insert after it.
          for (let j = i - 1; j >= 0; j--) {
            if (pos.has(windowIds[j])) { at = pos.get(windowIds[j]) + 1; break; }
          }
        }
        if (at === -1) at = order.length;          // first window ever seen
        order.splice(at, 0, id);
        for (let k = at; k < order.length; k++) pos.set(order[k], k);
      }
    };

    w.__clioSweep = () => {
      let added = 0;
      const nodes = [...document.querySelectorAll(sel)];
      for (const n of nodes) if (grab(n)) added++;
      stitch(nodes.map(n => n.getAttribute('data-message-id') || n.getAttribute('data-turn-id'))
                  .filter(Boolean));
      if (nodes.length > w.__clio.maxAtOnce) w.__clio.maxAtOnce = nodes.length;
      return added;
    };

    // Re-measure the ordering key for everything currently rendered.
    //
    // grab() measures once, at first sight — and first sight is a
    // MutationObserver callback, which fires DURING a React update, when a node
    // may be in the DOM but not yet in its final position. A single bad
    // measurement is permanent and silently corrupts the order.
    //
    // This runs from the driver between rounds, when the DOM has settled, and
    // overwrites the key. A message stays in the window for several rounds, so
    // nearly every message ends up with a settled measurement.
    w.__clioRemeasure = () => {
      const sc = w.__clioScroller();
      if (!sc) return 0;
      const sr = sc.getBoundingClientRect();
      let n = 0;
      for (const el of document.querySelectorAll(sel)) {
        const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id');
        const rec = id && w.__clio.store.get(id);
        if (!rec) continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;                 // not laid out yet
        rec.fromBottom = sc.scrollHeight - (r.top - sr.top + sc.scrollTop);
        rec.measuredSettled = true;
        n++;
      }
      return n;
    };

    // Download buttons visible RIGHT NOW that have not been clicked yet.
    // Returned to the driver, which does the clicking — a click from inside
    // evaluate() does not raise Playwright's download event.
    w.__clioPendingDownloads = () => {
      const out = [];
      let i = 0;
      for (const el of document.querySelectorAll('button, a, [role="menuitem"]')) {
        const label = (el.getAttribute('aria-label') || el.innerText || '').trim();
        if (!/^download\b/i.test(label)) continue;
        if (/^download apps?$/i.test(label)) continue;      // the app promo
        if (w.__clio.seenDl.has(label)) continue;
        el.setAttribute('data-clio-dl', String(++i));
        out.push({ label, mark: String(i) });
      }
      return out;
    };
    w.__clioMarkDone = (label) => w.__clio.seenDl.add(label);

    // Defined BEFORE the first sweep — grab() needs it to measure each
    // message's distance from the bottom, and the opening window would
    // otherwise be captured with no ordering key at all.
    w.__clioScroller = () => {
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
    };

    w.__clioSweep();
    new MutationObserver(() => w.__clioSweep())
      .observe(document.body, { childList: true, subtree: true });
  }, [MSG_SEL, FIRST_MESSAGE_MARKER]);

  const state = () => page.evaluate(() => {
    const el = window.__clioScroller();
    window.__clioSweep();
    window.__clioRemeasure();   // settled DOM: fix up any mid-update measurement
    return {
      count: window.__clio.store.size,
      files: window.__clio.files.size,
      foundFirst: window.__clio.foundFirst,
      scrollHeight: el ? el.scrollHeight : 0
    };
  });

  // Click whatever download buttons are on screen right now. Runs EVERY round,
  // which is the entire point — after the scroll they are gone.
  async function harvestDownloads() {
    let pending = [];
    try { pending = await page.evaluate(() => window.__clioPendingDownloads()); }
    catch (e) { return 0; }
    let n = 0;
    for (const p of pending) {
      try {
        const el = await page.$(`[data-clio-dl="${p.mark}"]`);
        if (!el) continue;
        say(`    clicking: ${p.label}`);
        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
          el.click({ timeout: 5000 })
        ]);
        if (dl) {
          const name = safe(dl.suggestedFilename());
          const dest = path.join(ART_DIR, name);
          await dl.saveAs(dest);
          const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
          downloads.push({ name, path: dest, bytes: size, label: p.label });
          say(`    saved: ${name} (${size} bytes)`);
        }
        await page.evaluate((l) => window.__clioMarkDone(l), p.label);
        n++;
        await sleep(600);
      } catch (e) {
        await page.evaluate((l) => window.__clioMarkDone(l), p.label).catch(() => {});
      }
    }
    if (n) flush();
    return n;
  }

  const startedAt = Date.now();
  let quiet = 0, round = 0;
  let last = await state();
  await harvestDownloads();
  say(`  start: ${last.count} messages, ${last.files} file cards, height ${last.scrollHeight}`);
  flush();

  while (Date.now() - startedAt < MAX_MS) {
    round++;
    await page.evaluate(() => {
      const el = window.__clioScroller();
      if (!el) return;
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    let grew = false;
    const waitStart = Date.now();
    while (Date.now() - waitStart < GROWTH_WAIT_MS) {
      await sleep(700);
      const now = await state();
      if (now.count > last.count || now.scrollHeight > last.scrollHeight) { grew = true; last = now; break; }
      last = now;
      if (now.foundFirst) break;
    }

    await harvestDownloads();

    const cur = await state();
    if (cur.foundFirst) {
      say(`  reached the FIRST message after ${round} rounds — ${cur.count} messages, ${cur.files} file cards.`);
      flush();
      break;
    }
    if (grew) {
      quiet = 0;
      say(`  round ${round}: ${cur.count} messages, ${cur.files} files, height ${cur.scrollHeight}, artifacts ${downloads.length}`);
      flush();
      continue;
    }

    await page.evaluate(() => {
      const el = window.__clioScroller();
      if (!el) return;
      el.scrollTop = 600;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
      setTimeout(() => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: -1200, bubbles: true }));
      }, 400);
    });
    await sleep(3000);
    const after = await state();
    if (after.count > cur.count || after.scrollHeight > cur.scrollHeight) { quiet = 0; last = after; continue; }

    quiet += GROWTH_WAIT_MS + 3000;
    say(`  round ${round}: nothing new — quiet ${Math.round(quiet / 1000)}s of ${QUIET_LIMIT_MS / 1000}s`);
    flush();
    if (quiet >= QUIET_LIMIT_MS) { say('  giving up; first message never appeared.'); flush(); break; }
  }

  await harvestDownloads();

  const result = await page.evaluate(() => {
    const store = window.__clio.store;

    // Primary key: distance from the bottom of the scroller, measured at
    // capture time and invariant under prepending. Largest = oldest = first.
    // Stitched window order breaks ties and orders anything unmeasured.
    const stitchRank = new Map(window.__clio.order.map((id, i) => [id, i]));
    const ordered = [...store.values()];
    const noKey = ordered.filter(m => m.fromBottom == null).length;
    ordered.sort((a, b) => {
      if (a.fromBottom != null && b.fromBottom != null && a.fromBottom !== b.fromBottom) {
        return b.fromBottom - a.fromBottom;
      }
      if (a.fromBottom == null && b.fromBottom != null) return -1;
      if (a.fromBottom != null && b.fromBottom == null) return 1;
      return (stitchRank.get(a.id) ?? 1e9) - (stitchRank.get(b.id) ?? 1e9);
    });
    const appended = noKey;
    const unsettled = ordered.filter(m => !m.measuredSettled).length;
    ordered.forEach((m, i) => { m.index = i; });

    const fileList = [...window.__clio.files.values()];
    const rank = new Map(ordered.map((m, i) => [m.id, i]));
    fileList.sort((a, b) => (rank.get(a.messageId) ?? 1e9) - (rank.get(b.messageId) ?? 1e9));

    return {
      title: document.title,
      url: location.href,
      capturedAt: new Date().toISOString(),
      maxSimultaneouslyInDom: window.__clio.maxAtOnce,
      reachedFirstMessage: window.__clio.foundFirst,
      orderedBy: 'distance-from-scroller-bottom at capture time (invariant under prepending); window-stitching breaks ties',
      messagesWithoutOrderKey: appended,
      messagesNeverMeasuredOnSettledDom: unsettled,
      uploadedFiles: fileList,
      messages: ordered
    };
  });

  fs.writeFileSync(path.join(OUT_DIR, 'conversation.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'uploaded-files.json'), JSON.stringify(result.uploadedFiles, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'downloads.json'), JSON.stringify(downloads, null, 2));

  let codeCount = 0, labelled = 0;
  result.messages.forEach((m, mi) => {
    m.codeBlocks.forEach((c, ci) => {
      const lang = (c.language || '').toLowerCase();
      if (lang) labelled++;
      const ext = EXT[lang] || 'txt';
      fs.writeFileSync(
        path.join(CODE_DIR, `${String(mi + 1).padStart(4, '0')}-${String(ci + 1).padStart(2, '0')}-${m.role}.${ext}`),
        c.code, 'utf8');
      codeCount++;
    });
  });

  say('');
  say('--- harvest ---');
  say(`  reached the first message:  ${result.reachedFirstMessage}`);
  say(`  messages captured:          ${result.messages.length}`);
  say(`  most in the DOM at once:    ${result.maxSimultaneouslyInDom}`);
  say(`  code blocks written:        ${codeCount}  (${labelled} with a language)`);
  say(`  uploaded file cards seen:   ${result.uploadedFiles.length}  -> uploaded-files.json`);
  say(`  artifact files downloaded:  ${downloads.length}  -> ${ART_DIR}`);
  for (const d of downloads) say(`      ${d.name}  ${d.bytes} bytes`);
  say('');
  say(`  conversation JSON: ${path.join(OUT_DIR, 'conversation.json')}`);
  flush();
  // No browser.close() — the operator owns that window.
}

main().catch((e) => {
  say('DRIVER ERROR: ' + (e && e.stack ? e.stack : String(e)));
  flush();
  process.exitCode = 1;
});
