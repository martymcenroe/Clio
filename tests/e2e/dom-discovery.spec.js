// @ts-check
/**
 * DOM discovery harness for Clio 2.0 sidebar harvesting (#47).
 *
 * One test per site (Gemini / Claude / ChatGPT). Each opens a headed
 * Chromium, pauses for the user to log in and navigate to the
 * conversation-list view, then runs structural analysis and writes:
 *
 *   docs/dom-dumps/{site}.json           structured report
 *   tests/fixtures/sidebar-{site}.html   full page HTML for jsdom tests
 *
 * Run:  npm run test:e2e -- dom-discovery
 * Runbook: docs/runbooks/30001-development-runbook.md §DOM Discovery (F1)
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'dom-dumps');
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

const SITES = [
  {
    id: 'gemini',
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
    hint: 'Log into Google. Ensure the Chat history sidebar (left panel) is visible.'
  },
  {
    id: 'claude',
    label: 'Claude',
    url: 'https://claude.ai/',
    hint: 'Log into Claude. Make sure the conversation list in the left sidebar is visible.'
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    hint: 'Log into ChatGPT. If the sidebar is collapsed, expand it before resuming.'
  }
];

// channel: 'chrome' launches the user's installed system Chrome instead of
// Playwright's bundled Chromium — Google's anti-automation fingerprinting
// blocks sign-in on bundled Chromium ("This browser or app may not be
// secure"). --disable-blink-features=AutomationControlled removes the
// navigator.webdriver signal that Playwright sets by default.
test.use({
  headless: false,
  viewport: { width: 1400, height: 900 },
  channel: 'chrome',
  launchOptions: {
    args: ['--disable-blink-features=AutomationControlled']
  }
});

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
});

test.describe.serial('DOM discovery — Clio 2.0 sidebar harvesting (#47)', () => {
  for (const site of SITES) {
    test(site.label, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'DOM discovery is Chromium-only');
      test.setTimeout(0);

      console.log(`\n=== ${site.label.toUpperCase()} — ${site.url} ===`);
      console.log(`Hint: ${site.hint}`);
      console.log('After login + navigation, click Resume in the Playwright Inspector.\n');

      await page.goto(site.url, { waitUntil: 'domcontentloaded' });
      await page.pause();

      const dump = await dumpSite(page);

      const jsonPath = path.join(OUT_DIR, `${site.id}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(dump, null, 2));

      const htmlPath = path.join(FIXTURES_DIR, `sidebar-${site.id}.html`);
      fs.writeFileSync(htmlPath, await page.content());

      console.log(`\n✓ ${site.label}`);
      console.log(`  Dump:       ${path.relative(process.cwd(), jsonPath)}`);
      console.log(`  Fixture:    ${path.relative(process.cwd(), htmlPath)}`);
      console.log(`  Scrollables: ${dump.scrollableContainers.length}`);
      if (dump.mostLikelySidebar) {
        const fps = dump.mostLikelySidebar.childClassFingerprints || {};
        const top = Object.entries(fps).sort((a, b) => b[1] - a[1])[0];
        console.log(`  Sidebar:    ${dump.mostLikelySidebarSelector}`);
        console.log(`  Children:   ${dump.mostLikelySidebar.childCount}`);
        if (top) console.log(`  Pattern:    ${top[1]}x "${top[0] || '(no classes)'}"`);
      }
      if (dump.urlScheme && dump.urlScheme.afterUrl) {
        console.log(`  URL click:  ${dump.urlScheme.afterUrl}`);
      } else if (dump.urlScheme && dump.urlScheme.error) {
        console.log(`  URL click:  ERROR — ${dump.urlScheme.error}`);
      }

      expect(dump.scrollableContainers.length).toBeGreaterThan(0);
    });
  }
});

/**
 * Full analysis pass over a logged-in, conversation-list-visible page.
 * Phases: structural → lazy-load → URL-click sample.
 */
async function dumpSite(page) {
  // --------------------------------------------------------------------- //
  // Phase 1: structural analysis (side-effect free)                       //
  // --------------------------------------------------------------------- //
  const analysis = await page.evaluate(() => {
    function describeElement(el, maxDepth = 6) {
      const parts = [];
      let cur = el;
      while (cur && cur !== document.body && parts.length < maxDepth) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) part += `#${cur.id}`;
        if (cur.classList.length) {
          const cls = Array.from(cur.classList).slice(0, 3);
          part += '.' + cls.join('.');
        }
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    function ancestorChain(el, maxDepth = 10) {
      const chain = [];
      let cur = el;
      while (cur && cur !== document && chain.length < maxDepth) {
        chain.push({
          tag: cur.tagName ? cur.tagName.toLowerCase() : null,
          id: cur.id || null,
          classes: Array.from(cur.classList || []),
          role: cur.getAttribute ? cur.getAttribute('role') : null,
          ariaLabel: cur.getAttribute ? cur.getAttribute('aria-label') : null,
          dataTestid: cur.getAttribute ? cur.getAttribute('data-testid') : null
        });
        cur = cur.parentElement;
      }
      return chain;
    }

    const scrollables = [];
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const scrolls = style.overflowY === 'auto' || style.overflowY === 'scroll';
      if (scrolls && el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 100) {
        scrollables.push(el);
      }
    }

    const analyzed = scrollables.map(container => {
      const childClassFingerprints = {};
      const childTagCounts = {};
      for (const child of container.children) {
        const tag = child.tagName;
        childTagCounts[tag] = (childTagCounts[tag] || 0) + 1;
        const fp = Array.from(child.classList).sort().join('.');
        childClassFingerprints[fp] = (childClassFingerprints[fp] || 0) + 1;
      }
      const deepFingerprints = {};
      if (container.children.length < 5 && container.children[0]) {
        for (const grandchild of container.children[0].children) {
          const fp = Array.from(grandchild.classList).sort().join('.');
          deepFingerprints[fp] = (deepFingerprints[fp] || 0) + 1;
        }
      }
      return {
        selector: describeElement(container),
        outerClasses: (container.className || '').toString().slice(0, 200),
        childCount: container.children.length,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        childTagCounts,
        childClassFingerprints,
        deepFingerprints,
        sampleChildren: Array.from(container.children).slice(0, 3).map(c => ({
          tag: c.tagName.toLowerCase(),
          classes: Array.from(c.classList),
          outerHTML: c.outerHTML.slice(0, 800)
        })),
        firstChildAncestorChain: container.children[0] ? ancestorChain(container.children[0]) : null
      };
    });

    const scored = analyzed
      .map(a => {
        const directMax = Math.max(0, ...Object.values(a.childClassFingerprints));
        const deepMax = Math.max(0, ...Object.values(a.deepFingerprints));
        return Object.assign({}, a, { repeatScore: Math.max(directMax, deepMax) });
      })
      .sort((x, y) => y.repeatScore - x.repeatScore);

    const mostLikelySidebar = scored[0] && scored[0].repeatScore >= 5 ? scored[0] : null;

    const accountSelectors = [
      'img[alt*="account" i]',
      'img[alt*="profile" i]',
      'img[alt*="user" i]',
      '[aria-label*="account" i]',
      '[aria-label*="profile" i]',
      '[aria-label*="user menu" i]',
      '[role="button"][aria-haspopup="menu"]',
      'button[aria-label*="Google Account" i]'
    ];
    const accountCandidates = [];
    const seenEls = new Set();
    for (const sel of accountSelectors) {
      let matches = [];
      try { matches = Array.from(document.querySelectorAll(sel)); } catch (e) { continue; }
      for (const el of matches) {
        if (seenEls.has(el)) continue;
        seenEls.add(el);
        accountCandidates.push({
          matchedSelector: sel,
          selector: describeElement(el),
          outerHTML: el.outerHTML.slice(0, 500),
          ariaLabel: el.getAttribute('aria-label'),
          alt: el.getAttribute('alt'),
          src: el.getAttribute('src'),
          ancestorChain: ancestorChain(el)
        });
        if (accountCandidates.length >= 15) break;
      }
      if (accountCandidates.length >= 15) break;
    }

    return {
      url: location.href,
      hostname: location.hostname,
      title: document.title,
      timestamp: new Date().toISOString(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollableContainers: analyzed.slice(0, 10),
      mostLikelySidebar,
      accountMenuCandidates: accountCandidates
    };
  });

  analysis.mostLikelySidebarSelector = analysis.mostLikelySidebar
    ? analysis.mostLikelySidebar.selector
    : null;

  // --------------------------------------------------------------------- //
  // Phase 2: lazy-load probe — scroll the sidebar and log child counts    //
  // --------------------------------------------------------------------- //
  try {
    analysis.lazyLoad = await page.evaluate(async () => {
      const scrollables = [];
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 10 &&
            el.clientHeight > 100 &&
            el.children.length > 5) {
          scrollables.push(el);
        }
      }
      let best = null;
      let bestScore = 0;
      for (const c of scrollables) {
        const fps = {};
        for (const ch of c.children) {
          const fp = Array.from(ch.classList).sort().join('.');
          fps[fp] = (fps[fp] || 0) + 1;
        }
        const m = Math.max(0, ...Object.values(fps));
        if (m > bestScore) { bestScore = m; best = c; }
      }
      if (!best) return { error: 'no sidebar candidate for lazy-load probe' };

      const history = [{ scrollTop: best.scrollTop, count: best.children.length }];
      for (let i = 0; i < 20; i++) {
        const prevCount = best.children.length;
        best.scrollTop = best.scrollHeight;
        await new Promise(r => setTimeout(r, 500));
        const newCount = best.children.length;
        history.push({ scrollTop: best.scrollTop, count: newCount });
        if (newCount === prevCount && i >= 2) break;
      }
      return {
        initialCount: history[0].count,
        finalCount: history[history.length - 1].count,
        scrollIterations: history.length - 1,
        history
      };
    });
  } catch (e) {
    analysis.lazyLoad = { error: String(e.message || e) };
  }

  // --------------------------------------------------------------------- //
  // Phase 3: URL scheme sample — click first sidebar item, capture URL    //
  // --------------------------------------------------------------------- //
  try {
    const beforeUrl = page.url();
    const clickResult = await page.evaluate(() => {
      const scrollables = [];
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 10 &&
            el.clientHeight > 100 &&
            el.children.length > 5) {
          scrollables.push(el);
        }
      }
      let best = null;
      let bestScore = 0;
      for (const c of scrollables) {
        const fps = {};
        for (const ch of c.children) {
          const fp = Array.from(ch.classList).sort().join('.');
          fps[fp] = (fps[fp] || 0) + 1;
        }
        const m = Math.max(0, ...Object.values(fps));
        if (m > bestScore) { bestScore = m; best = c; }
      }
      if (!best) return { clicked: false, reason: 'no sidebar candidate' };

      best.scrollTop = 0;
      const firstItem = best.children[0];
      if (!firstItem) return { clicked: false, reason: 'sidebar has no children' };

      const anchor = firstItem.querySelector('a[href]');
      const target = anchor || firstItem;
      target.click();
      return {
        clicked: true,
        targetTag: target.tagName.toLowerCase(),
        targetHref: anchor ? anchor.getAttribute('href') : null,
        hadAnchor: !!anchor,
        firstItemOuterHTML: firstItem.outerHTML.slice(0, 400)
      };
    });

    if (clickResult.clicked) {
      try {
        await page.waitForFunction(u => location.href !== u, beforeUrl, { timeout: 5000 });
        analysis.urlScheme = {
          beforeUrl,
          afterUrl: page.url(),
          clickDetails: clickResult,
          capturedAt: new Date().toISOString()
        };
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      } catch (e) {
        analysis.urlScheme = {
          beforeUrl,
          error: `URL did not change within 5s (${String(e.message || e)})`,
          clickDetails: clickResult
        };
      }
    } else {
      analysis.urlScheme = { error: clickResult.reason };
    }
  } catch (e) {
    analysis.urlScheme = { error: String(e.message || e) };
  }

  return analysis;
}
