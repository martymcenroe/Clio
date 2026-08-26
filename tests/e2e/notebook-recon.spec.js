// @ts-check
/**
 * Gemini notebooks recon harness (#241, umbrella #246).
 *
 * Staged, operator-paced capture of the notebooks surface reachable from
 * the Gemini page. Opens a headed system Chrome with the persistent
 * `gemini` profile (login should already be cached from the dom-discovery
 * harness). The operator arranges each view; the harness captures it.
 *
 * Four stages, in order. Before each stage a banner on the page says what
 * to arrange; when the view is ready the operator clicks Resume (▶) in
 * the Playwright Inspector window and the harness captures:
 *
 *   1. conversation — target notebook open, conversation track visible
 *   2. artifacts    — right-side artifact panel visible/expanded
 *   3. sources      — uploaded-sources list visible
 *   4. transcript   — one m4a source open with its transcript visible
 *
 * Outputs (all under RECON_OUT, default data/recon/notebooks/):
 *   fixtures/notebook-{stage}.html   full page HTML dump
 *   screens/{stage}.png              screenshot
 *   report.json                      URLs + structural scans
 *   network.jsonl                    request/response metadata (continuous)
 *   bodies/*.txt                     xhr/fetch response payloads (continuous)
 *
 * HYGIENE: this repo is PUBLIC and every output of this harness carries
 * personal notebook content and/or session-bearing URLs. ALL outputs —
 * DOM dumps included — go under gitignored data/ and MUST NEVER be
 * committed. Sanitized jsdom fixtures are authored deliberately, per
 * extractor, never copied from these dumps wholesale. No request or
 * response headers are recorded, ever.
 *
 * Env knobs (reruns / other notebooks):
 *   RECON_START_URL  jump straight to a notebook URL (skip the Gemini hop)
 *   RECON_STAGES     comma-separated stage ids to run (default: all four)
 *   RECON_OUT        output root (default data/recon/notebooks) — point at
 *                    a fresh dir per notebook so runs never clobber
 *
 * The harness NEVER closes the browser window — the operator always does.
 * Login persists in the profile across runs (first run only asks).
 *
 * Run:  npm run test:e2e:notebook-recon
 * ADR:  docs/adrs/0201-playwright-system-chrome-channel.md
 *       (Option A — channel:chrome — AND Option B — persistent profile)
 */

const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RECON_DIR = process.env.RECON_OUT
  ? path.resolve(process.env.RECON_OUT)
  : path.join(__dirname, '..', '..', 'data', 'recon', 'notebooks');
const FIXTURES_DIR = path.join(RECON_DIR, 'fixtures');
const SCREENS_DIR = path.join(RECON_DIR, 'screens');
const BODIES_DIR = path.join(RECON_DIR, 'bodies');
const PROFILES_ROOT = path.join(os.homedir(), '.clio-profiles');

// Override to jump straight to a known notebook URL on reruns.
const START_URL = process.env.RECON_START_URL || 'https://gemini.google.com/app';

// Response bodies larger than this are logged but not saved.
const BODY_CAP_BYTES = 5 * 1024 * 1024;

const STAGES = [
  {
    id: 'conversation',
    instruction:
      'Log in if needed, then open the TARGET NOTEBOOK so the conversation track (the chat exchange) is visible.'
  },
  {
    id: 'artifacts',
    instruction:
      'Make the RIGHT-SIDE ARTIFACT PANEL visible and expanded so every downloadable artifact is listed.'
  },
  {
    id: 'sources',
    instruction:
      'Make the UPLOADED-SOURCES LIST visible (expand it if it is collapsed).'
  },
  {
    id: 'transcript',
    instruction:
      'Open ONE M4A RECORDING source so its generated transcript is visible on screen.'
  }
];

// RECON_STAGES=transcript (comma-separated ids) reruns a subset without
// re-capturing the stages that already landed.
const stageFilter = (process.env.RECON_STAGES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const ACTIVE_STAGES = stageFilter.length
  ? STAGES.filter(s => stageFilter.includes(s.id))
  : STAGES;

test.describe.serial('Notebook recon — Gemini notebooks surfaces (#241)', () => {
  test('staged capture', async ({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Notebook recon is Chromium-only');
    test.setTimeout(0);

    for (const dir of [FIXTURES_DIR, SCREENS_DIR, BODIES_DIR]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Reuse the dom-discovery gemini profile — same Google account, and
    // login is very likely already cached there (ADR-0201 Option B).
    const userDataDir = path.join(PROFILES_ROOT, 'gemini');
    fs.mkdirSync(userDataDir, { recursive: true });
    const isFirstRun = fs.readdirSync(userDataDir).length === 0;

    // The profile can be locked by a still-open Chrome using it (e.g. a
    // browser left over from an earlier run — the operator closes those,
    // never the harness). Retry until the lock frees instead of failing.
    let context = null;
    let launchErr = null;
    for (let attempt = 1; attempt <= 60; attempt++) {
      try {
        context = await chromium.launchPersistentContext(userDataDir, {
          channel: 'chrome',
          headless: false,
          viewport: { width: 1600, height: 950 },
          args: ['--disable-blink-features=AutomationControlled'],
          recordVideo: { dir: testInfo.outputDir }
        });
        break;
      } catch (e) {
        launchErr = e;
        console.log(`Launch attempt ${attempt}/60 failed — profile likely locked by another Chrome window using ${userDataDir}. Close that window; retrying in 5s…`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    if (!context) throw launchErr;

    await context.tracing.start({ screenshots: true, snapshots: true });

    // ------------------------------------------------------------------ //
    // Network capture — metadata for every response, bodies for          //
    // xhr/fetch/document payloads that look textual. Headers are never   //
    // recorded.                                                          //
    // ------------------------------------------------------------------ //
    const networkLogPath = path.join(RECON_DIR, 'network.jsonl');
    fs.writeFileSync(networkLogPath, '');
    let currentStage = 'startup';
    let seq = 0;

    function logNetwork(entry) {
      try {
        fs.appendFileSync(networkLogPath, JSON.stringify(entry) + '\n');
      } catch (e) {
        console.error('network log append failed:', e.message);
      }
    }

    context.on('response', async response => {
      const request = response.request();
      const resourceType = request.resourceType();
      const entry = {
        ts: new Date().toISOString(),
        stage: currentStage,
        n: ++seq,
        method: request.method(),
        url: response.url(),
        status: response.status(),
        resourceType,
        contentType: (response.headers()['content-type'] || '').split(';')[0]
      };
      const wantBody =
        ['xhr', 'fetch', 'document', 'other'].includes(resourceType) &&
        !/^(image|audio|video|font)\//.test(entry.contentType);
      if (wantBody) {
        try {
          const body = await response.body();
          entry.bodyBytes = body.length;
          if (body.length > 0 && body.length <= BODY_CAP_BYTES) {
            const host = new URL(entry.url).hostname.replace(/[^a-z0-9.-]/gi, '_');
            const hash = crypto.createHash('sha1').update(entry.url).digest('hex').slice(0, 8);
            const bodyFile = `${String(entry.n).padStart(5, '0')}-${host}-${hash}.txt`;
            fs.writeFileSync(path.join(BODIES_DIR, bodyFile), body);
            entry.bodyFile = bodyFile;
          }
        } catch (e) {
          entry.bodyError = String(e.message || e).slice(0, 200);
        }
      }
      logNetwork(entry);
    });

    context.on('requestfailed', request => {
      logNetwork({
        ts: new Date().toISOString(),
        stage: currentStage,
        failed: true,
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        failure: (request.failure() || {}).errorText || null
      });
    });

    // ------------------------------------------------------------------ //
    // Operator banner — survives navigation via re-injection.            //
    // ------------------------------------------------------------------ //
    let bannerTitle = null;
    let bannerText = null;

    async function injectBanner(p) {
      if (!bannerTitle) return;
      try {
        await p.evaluate(([t, x]) => {
          let b = document.getElementById('clio-recon-banner');
          if (!b) {
            b = document.createElement('div');
            b.id = 'clio-recon-banner';
            b.style.cssText = [
              'position: fixed',
              'top: 8px',
              'left: 50%',
              'transform: translateX(-50%)',
              'max-width: 720px',
              'background: #1e1e1e',
              'color: #fff',
              'border: 2px solid #f9ab00',
              'border-radius: 8px',
              'padding: 12px 18px',
              'z-index: 2147483647',
              'box-shadow: 0 4px 12px rgba(0,0,0,0.5)',
              'font-family: system-ui, sans-serif',
              'font-size: 14px',
              'line-height: 1.5',
              'pointer-events: none',
              'opacity: 0.95'
            ].join(';');
            document.documentElement.appendChild(b);
          }
          const strong = document.createElement('strong');
          strong.textContent = t;
          const body = document.createElement('div');
          body.textContent = x;
          const em = document.createElement('em');
          em.textContent = 'When the view is ready, click Resume (▶) in the Playwright Inspector window.';
          b.replaceChildren(strong, body, em);
        }, [bannerTitle, bannerText]);
      } catch (e) {
        // Page mid-navigation or closed — the domcontentloaded hook retries.
      }
    }

    async function clearBanner(p) {
      bannerTitle = null;
      bannerText = null;
      try {
        await p.evaluate(() => {
          const b = document.getElementById('clio-recon-banner');
          if (b) b.remove();
        });
      } catch (e) {
        // Non-fatal.
      }
    }

    function hookPage(p) {
      p.on('domcontentloaded', () => injectBanner(p));
    }

    let activePage = context.pages()[0] || (await context.newPage());
    hookPage(activePage);
    context.on('page', p => {
      hookPage(p);
      activePage = p;
    });

    // The operator may work in whichever tab — capture the right one.
    // Prefer the OS-focused page; with the Inspector holding focus, no
    // page reports hasFocus(), so fall back to the NEWEST visible page
    // (multiple windows can all be "visible" — run 1 captured a stale
    // first-visible tab twice because of exactly that).
    async function pickActivePage() {
      const candidates = [];
      for (const p of context.pages()) {
        try {
          const state = await p.evaluate(() => ({
            visible: document.visibilityState === 'visible',
            focused: document.hasFocus()
          }));
          if (state.visible) candidates.push({ p, focused: state.focused });
        } catch (e) {
          // Closed or navigating — skip.
        }
      }
      const focused = candidates.find(c => c.focused);
      if (focused) return focused.p;
      if (candidates.length) return candidates[candidates.length - 1].p;
      return activePage;
    }

    // ------------------------------------------------------------------ //
    // Structural scan — selector candidates + completeness signals.      //
    // ------------------------------------------------------------------ //
    async function scanPage(p) {
      return p.evaluate(() => {
        function describeElement(el, maxDepth = 6) {
          const parts = [];
          let cur = el;
          while (cur && cur !== document.body && parts.length < maxDepth) {
            let part = cur.tagName.toLowerCase();
            if (cur.id) part += '#' + cur.id;
            if (cur.classList && cur.classList.length) {
              part += '.' + Array.from(cur.classList).slice(0, 3).join('.');
            }
            parts.unshift(part);
            cur = cur.parentElement;
          }
          return parts.join(' > ');
        }

        const aria = [];
        for (const el of document.querySelectorAll('[aria-label]')) {
          if (aria.length >= 300) break;
          if (el.id === 'clio-recon-banner') continue;
          aria.push({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            testid: el.getAttribute('data-testid') || el.getAttribute('data-test-id'),
            selector: describeElement(el),
            textHead: (el.textContent || '').trim().slice(0, 80)
          });
        }

        const roleCounts = {};
        for (const el of document.querySelectorAll('[role]')) {
          const r = el.getAttribute('role');
          roleCounts[r] = (roleCounts[r] || 0) + 1;
        }

        const customTags = {};
        for (const el of document.querySelectorAll('*')) {
          const tag = el.tagName.toLowerCase();
          if (tag.includes('-')) customTags[tag] = (customTags[tag] || 0) + 1;
        }

        const scrollables = [];
        for (const el of document.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
              el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 100) {
            const fps = {};
            for (const ch of el.children) {
              const fp = Array.from(ch.classList).sort().join('.');
              fps[fp] = (fps[fp] || 0) + 1;
            }
            scrollables.push({
              selector: describeElement(el),
              childCount: el.children.length,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              childClassFingerprints: fps
            });
          }
        }

        // Completeness signals — page.content() serializes neither
        // iframe documents nor shadow roots; flag them so we KNOW when
        // the fixture is missing subtree content.
        const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
          src: f.getAttribute('src'),
          name: f.getAttribute('name'),
          selector: describeElement(f)
        }));
        const shadowHosts = [];
        for (const el of document.querySelectorAll('*')) {
          if (el.shadowRoot) {
            shadowHosts.push({
              tag: el.tagName.toLowerCase(),
              selector: describeElement(el)
            });
            if (shadowHosts.length >= 50) break;
          }
        }

        return {
          url: location.href,
          hostname: location.hostname,
          title: document.title,
          timestamp: new Date().toISOString(),
          ariaLabeled: aria,
          roleCounts,
          customTags,
          scrollables: scrollables.slice(0, 15),
          iframes,
          shadowHosts
        };
      });
    }

    // ------------------------------------------------------------------ //
    // Stage loop                                                         //
    // ------------------------------------------------------------------ //
    const report = {
      startedAt: new Date().toISOString(),
      startUrl: START_URL,
      profile: userDataDir,
      firstRun: isFirstRun,
      stages: {}
    };

    try {
      console.log('\n=== NOTEBOOK RECON (#241) ===');
      console.log(`Profile: ${userDataDir}${isFirstRun ? ' (first run — login required)' : ' (cached login expected)'}`);
      console.log(`Stages: ${ACTIVE_STAGES.map(s => s.id).join(' → ')}\n`);

      await activePage.goto(START_URL, { waitUntil: 'domcontentloaded' });

      for (let i = 0; i < ACTIVE_STAGES.length; i++) {
        const stage = ACTIVE_STAGES[i];
        currentStage = stage.id;
        bannerTitle = `Clio recon — stage ${i + 1} of ${ACTIVE_STAGES.length}: ${stage.id}`;
        bannerText = stage.instruction;

        let p = await pickActivePage();
        await injectBanner(p);
        console.log(`\nStage ${i + 1}/${ACTIVE_STAGES.length} [${stage.id}]: ${stage.instruction}`);
        console.log('Waiting for Resume in the Playwright Inspector…');
        await p.pause();

        p = await pickActivePage();
        await clearBanner(p);

        const entry = { url: p.url(), capturedAt: new Date().toISOString() };
        try {
          entry.scan = await scanPage(p);
        } catch (e) {
          entry.scanError = String(e.message || e);
          console.error(`[${stage.id}] scan failed:`, entry.scanError);
        }
        try {
          await p.screenshot({ path: path.join(SCREENS_DIR, `${stage.id}.png`) });
        } catch (e) {
          console.error(`[${stage.id}] screenshot failed:`, e.message);
        }
        const fixturePath = path.join(FIXTURES_DIR, `notebook-${stage.id}.html`);
        try {
          fs.writeFileSync(fixturePath, await p.content());
          entry.fixtureBytes = fs.statSync(fixturePath).size;
        } catch (e) {
          entry.fixtureError = String(e.message || e);
          console.error(`[${stage.id}] page.content() failed:`, entry.fixtureError);
        }
        report.stages[stage.id] = entry;

        console.log(`✓ [${stage.id}] ${entry.url}`);
        if (entry.scan) {
          console.log(`  aria-labeled: ${entry.scan.ariaLabeled.length}, scrollables: ${entry.scan.scrollables.length}, iframes: ${entry.scan.iframes.length}, shadow hosts: ${entry.scan.shadowHosts.length}`);
        }
        if (entry.fixtureBytes) {
          console.log(`  fixture: ${path.relative(process.cwd(), fixturePath)} (${entry.fixtureBytes} bytes)`);
        }
      }

      // All captures saved — persist the trace, then hold.
      try {
        await context.tracing.stop({ path: path.join(testInfo.outputDir, 'trace.zip') });
      } catch (e) {
        // Context may already be gone; not fatal.
      }

      // OPERATOR DIRECTIVE (2026-08-25): the harness NEVER closes the
      // browser window — the operator always does. Stay attached until
      // they close it themselves.
      bannerTitle = 'Clio recon — DONE';
      bannerText =
        'All captures are saved. This window stays open — close it yourself whenever you are finished. The harness will not close it.';
      const doneP = await pickActivePage();
      await injectBanner(doneP);
      console.log('\nAll stages captured. Holding — close the browser window whenever you are done.');
      await new Promise(resolve => {
        context.on('close', resolve);
        if (context.pages().length === 0) resolve();
      });
    } finally {
      currentStage = 'shutdown';
      report.finishedAt = new Date().toISOString();
      fs.writeFileSync(path.join(RECON_DIR, 'report.json'), JSON.stringify(report, null, 2));
      console.log(`\nReport: ${path.relative(process.cwd(), path.join(RECON_DIR, 'report.json'))}`);
      console.log(`Network log: ${path.relative(process.cwd(), networkLogPath)}`);
      // No context.close() here — the operator owns the window.
    }

    // Every stage must have produced a real fixture — a near-empty dump
    // means the capture happened on a wrong/blank page.
    for (const stage of ACTIVE_STAGES) {
      const entry = report.stages[stage.id];
      expect(entry, `stage ${stage.id} missing`).toBeTruthy();
      expect(entry.fixtureBytes, `stage ${stage.id} fixture too small`).toBeGreaterThan(5000);
    }
  });
});
