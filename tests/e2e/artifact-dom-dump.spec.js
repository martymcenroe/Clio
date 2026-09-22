// @ts-check
/**
 * Claude artifact-widget DOM dump (#43).
 *
 * Opens a specific Claude conversation containing an artifact widget
 * (email draft / Send via Gmail / Subject: chrome), walks all
 * `.row-start-2` assistant turns, and dumps the DOM structure of any
 * turn that contains widget chrome. Output is sufficient to:
 *
 *   - identify the widget root selector
 *   - write a regression test fixture that mirrors real DOM
 *   - design the post-processing pass that strips widget chrome
 *
 * Login profile: reuses `~/.clio-profiles/claude/` from the
 * dom-discovery spec (ADR-0201 Option B). If the profile is not yet
 * authenticated, the spec falls back to `page.pause()` for one-time
 * manual login.
 *
 * Privacy: ALL output goes to `docs/dom-dumps/`, which is in the
 * fleet-wide `~/.gitignore_global` and cannot be committed. This spec
 * does NOT write to `tests/fixtures/` or any other tracked location.
 * The regression fixture used by the eventual jest test will be
 * hand-built from the dump's structural shape (tag names, class lists,
 * role attrs) with synthetic content — zero bytes of operator data in
 * any committed file.
 *
 * Run (two modes):
 *
 *   A) URL provided — fully automated:
 *      CLAUDE_ARTIFACT_URL=https://claude.ai/chat/<id> \
 *        npx playwright test artifact-dom-dump.spec.js --project=chromium
 *
 *   B) URL-less — opens claude.ai, you click any conversation with the
 *      email widget, then click Resume in the Playwright Inspector:
 *        npx playwright test artifact-dom-dump.spec.js --project=chromium
 *
 * Output (all under gitignored docs/dom-dumps/):
 *   claude-artifact-widget.json   structured (counts, chains, classes)
 *   claude-artifact-widget.html   full outerHTML of one artifact turn
 *                                 (raw, for local analysis only)
 */

const { test, expect } = require('@playwright/test');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'dom-dumps');
const PROFILE_DIR = path.join(os.homedir(), '.clio-profiles', 'claude');

const TARGETS_SOURCE = 'Send via Gmail|Subject:|Copy to|Open in|Add to|Save to';

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
});

test('Claude artifact-widget DOM dump (#43)', async ({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Anti-automation gate requires system Chrome (ADR-0201)');
  test.setTimeout(0);

  const url = process.env.CLAUDE_ARTIFACT_URL;

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 900 },
    // Remove Playwright's automation switch. Stealth plugin handles the rest
    // (navigator.webdriver, chrome.runtime, plugins, languages, WebGL, etc.).
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=AutomationControlled'
    ]
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    if (url) {
      console.log(`\nNavigating to ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } else {
      console.log('\n=== URL-less mode ===');
      console.log('1. The browser will open at claude.ai');
      console.log('2. Click ANY conversation that has the "Send via Gmail" / "Subject:" email widget');
      console.log('3. Once the conversation loads and you can SEE the widget on screen,');
      console.log('   click "Resume" in the Playwright Inspector window');
      console.log('4. The dump runs automatically against whatever conversation is loaded.\n');
      await page.goto('https://claude.ai/', { waitUntil: 'domcontentloaded' });
      await page.pause();
    }

    // If we landed on the login page, ask user to log in then resume.
    if (page.url().includes('/login')) {
      console.log('Login required. Sign in, navigate to a conversation with the widget, then click Resume.');
      await page.pause();
    }

    // If still at the root after URL-less mode, prompt again.
    if (page.url() === 'https://claude.ai/' && !url) {
      console.log('Still at claude.ai root — please click into a conversation, then click Resume.');
      await page.pause();
    }

    console.log(`Capturing DOM at: ${page.url()}`);
    // Wait for the assistant turns to render.
    console.log('Waiting for .row-start-2 to appear...');
    await page.waitForSelector('.row-start-2', { timeout: 60_000 });
    // Give lazy-loaded artifact chrome a moment to settle.
    await page.waitForTimeout(2000);

    const dump = await page.evaluate((targetsSource) => {
      const TARGETS = new RegExp(targetsSource, 'i');

      function summarizeEl(el, maxClassChars = 200) {
        if (!el || !el.tagName) return null;
        const cls = (el.className || '').toString().slice(0, maxClassChars);
        const data = {};
        for (const a of (el.attributes || [])) {
          if (/^(data-|role|aria-label|aria-expanded)/.test(a.name)) {
            data[a.name] = a.value;
          }
        }
        return {
          tag: el.tagName.toLowerCase(),
          classes: cls,
          attrs: data
        };
      }

      function ancestorChain(node, stopAt, maxDepth = 12) {
        const chain = [];
        let cur = node.parentElement || null;
        let depth = 0;
        while (cur && cur !== stopAt && depth < maxDepth) {
          chain.push(summarizeEl(cur));
          cur = cur.parentElement;
          depth++;
        }
        return chain;
      }

      function lowestCommonAncestor(nodes) {
        if (!nodes.length) return null;
        const chains = nodes.map(n => {
          const c = [];
          let cur = n;
          while (cur) { c.unshift(cur); cur = cur.parentElement; }
          return c;
        });
        let lca = null;
        for (let i = 0; i < Math.min(...chains.map(c => c.length)); i++) {
          const ref = chains[0][i];
          if (chains.every(c => c[i] === ref)) {
            lca = ref;
          } else {
            break;
          }
        }
        return lca;
      }

      const turns = [];
      const rawHtmlCandidates = [];

      rows.forEach((row, idx) => {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        const hits = [];
        while (walker.nextNode()) {
          const t = (walker.currentNode.textContent || '').trim();
          if (t && TARGETS.test(t)) hits.push(walker.currentNode);
        }
        if (!hits.length) return;

        const chromeHits = hits.map(node => ({
          text: node.textContent.trim().slice(0, 200),
          chain: ancestorChain(node, row)
        }));

        const widgetRootEl = lowestCommonAncestor(hits.map(n => n.parentElement));
        const widgetRoot = widgetRootEl ? summarizeEl(widgetRootEl, 400) : null;

        // Catalogue every element under the row that has widget-y classes or roles,
        // so we can identify selectable subtrees.
        const widgetIndicators = [];
        const candidateSelectors = [
          '[class*="artifact"]',
          '[class*="widget"]',
          '[class*="card"]',
          '[data-artifact]',
          '[data-widget]',
          '[role="article"]',
          '[role="region"]',
          '[role="dialog"]',
          'button[class*="row"]',
          'button'
        ];
        for (const sel of candidateSelectors) {
          let matches = [];
          try { matches = Array.from(row.querySelectorAll(sel)); } catch (e) { continue; }
          if (matches.length) {
            widgetIndicators.push({
              selector: sel,
              count: matches.length,
              samples: matches.slice(0, 3).map(m => summarizeEl(m, 200))
            });
          }
        }

        // Buttons inside the turn — useful for "strip these labels" rules
        const buttons = Array.from(row.querySelectorAll('button')).map(b => ({
          text: (b.textContent || '').trim().slice(0, 80),
          ariaLabel: b.getAttribute('aria-label'),
          classes: (b.className || '').toString().slice(0, 200)
        }));

        turns.push({
          turnIndex: idx,
          chromeHits,
          widgetRootGuess: widgetRoot,
          widgetIndicators,
          buttons,
          rowOuterHTMLLength: row.outerHTML.length
        });

        // Keep the first artifact turn's full outerHTML for local analysis.
        // This file goes to docs/dom-dumps/ which is gitignored — never tracked.
        if (rawHtmlCandidates.length === 0) {
          rawHtmlCandidates.push({
            turnIndex: idx,
            rawHTML: row.outerHTML
          });
        }
      });

      return {
        url: location.href,
        title: document.title,
        timestamp: new Date().toISOString(),
        totalAssistantTurns: rows.length,
        artifactTurnCount: turns.length,
        turns,
        rawHtmlSample: rawHtmlCandidates[0] || null
      };
    }, TARGETS_SOURCE);

    if (dump.artifactTurnCount === 0) {
      throw new Error(
        `No artifact turns found at ${page.url()}. ` +
        `Searched ${dump.totalAssistantTurns} .row-start-2 elements for /${TARGETS_SOURCE}/i. ` +
        `Confirm the conversation actually has a Send-via-Gmail / Subject: widget.`
      );
    }

    const jsonPath = path.join(OUT_DIR, 'claude-artifact-widget.json');
    const { rawHtmlSample, ...dumpForJson } = dump;
    fs.writeFileSync(jsonPath, JSON.stringify(dumpForJson, null, 2));

    let htmlPath = null;
    if (rawHtmlSample) {
      htmlPath = path.join(OUT_DIR, 'claude-artifact-widget.html');
      fs.writeFileSync(
        htmlPath,
        '<!-- Raw Claude artifact-widget turn for #43 — LOCAL ANALYSIS ONLY.\n' +
        '     This file is in docs/dom-dumps/ and gitignored via ~/.gitignore_global.\n' +
        '     DO NOT copy contents into any tracked file. The committed regression\n' +
        '     fixture is hand-built from structural shape with synthetic content.\n' +
        '     Source turnIndex: ' + rawHtmlSample.turnIndex + '\n' +
        '     Generated: ' + dump.timestamp + ' -->\n' +
        rawHtmlSample.rawHTML
      );
    }

    console.log(`\n✓ Artifact-widget DOM dump complete`);
    console.log(`  Assistant turns scanned: ${dump.totalAssistantTurns}`);
    console.log(`  Artifact turns found:    ${dump.artifactTurnCount}`);
    console.log(`  JSON: ${path.relative(process.cwd(), jsonPath)}`);
    if (htmlPath) console.log(`  HTML: ${path.relative(process.cwd(), htmlPath)} (gitignored)`);

    expect(dump.artifactTurnCount).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
