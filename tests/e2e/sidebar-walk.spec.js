// @ts-check
/**
 * Clio 2.0 — LIVE proof: enumerate the sidebar and switch between conversations.
 *
 * This is the "prove you can enumerate and switch" first step. It opens a real
 * headed Chrome (your persistent ~/.clio-profiles/gemini profile — login from
 * the F1 run may still be valid), then:
 *
 *   1. Waits for you to confirm the chat-history sidebar is visible (page.pause).
 *   2. Enumerates every conversation using the SAME item selector and title
 *      cleanup the shipped extension uses — SITE_LISTS.gemini and cleanTitle
 *      from extensions/src/enumerate.js, imported here so there is one source
 *      of truth for the selector that matters.
 *   3. Walks the first N conversations: clicks each in the sidebar, waits for the
 *      URL to switch to /app/{id}, and confirms the main pane changed. You watch
 *      it happen; the console prints a play-by-play.
 *   4. Saves the raw sidebar DOM to data/sidebar-captures/ (gitignored).
 *
 * Run (from C:\Users\mcwiz\Projects\Clio, in PowerShell or bash):
 *
 *     npx playwright test tests/e2e/sidebar-walk.spec.js --project=chromium
 *
 * Gemini only for now — it's the site with verified sidebar selectors. Claude /
 * ChatGPT need their real DOM captured first (F1 re-run).
 *
 * PRIVACY (#363). The capture is the operator's real conversation list and this
 * repo is PUBLIC, so it is written to a gitignored directory and NEVER to
 * tests/fixtures/. An earlier draft of this spec wrote page.content() straight
 * over tests/fixtures/sidebar-gemini.html — a tracked file deliberately scrubbed
 * by PR #340 — which would have put 53 real titles and ids in a public repo with
 * every existing test still passing. Turning a capture into a committable
 * fixture is a separate, deliberate step:
 *
 *     node tools/scrub-sidebar-fixtures.js data/sidebar-captures
 *
 * This spec does not write to any tracked path. Keep it that way.
 */

const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SITE_LISTS, cleanTitle } = require('../../extensions/src/enumerate.js');

const PROFILES_ROOT = path.join(os.homedir(), '.clio-profiles');
// Gitignored (the repo-wide `data/` rule). NEVER tests/fixtures — see the
// privacy note in the header (#363).
const CAPTURES_DIR = path.join(__dirname, '..', '..', 'data', 'sidebar-captures');
const SITE = { id: 'gemini', url: 'https://gemini.google.com/app' };
const WALK_COUNT = 5; // how many conversations to switch through as the proof

// The item selector and the title cleanup come from the shipped reader, so this
// live probe and the extension agree on what a conversation row is. The two
// selectors below are sidebar *chrome* that enumerate.js has no reason to carry:
// it reads a whole document, while this spec has to scope to the sidebar and
// scroll it. Verified against the real captured DOM (PR #340's fixture).
const GEMINI_SIDEBAR = {
  container: '[data-test-id="all-conversations"]',
  title: '.conversation-title',
  listItem: SITE_LISTS.gemini.itemSelector,
  urlAttr: 'href',
};

// Mirrors the /app/{id} pattern in SITE_LISTS.gemini.idFromItem. Duplicated only
// because idFromItem takes a live element and this parses hrefs already brought
// back from the page.
const GEMINI_ID = /\/app\/([0-9a-z]+)/i;
const parseConversationId = (url) => {
  const m = (url || '').match(GEMINI_ID);
  return m ? m[1] : null;
};

test.describe.serial('Clio 2.0 — sidebar enumerate + switch (live)', () => {
  test('Gemini: enumerate all, then switch through the first few', async ({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Live walk is Chromium-only');
    test.setTimeout(0); // no timeout — human-in-the-loop login/verify

    const userDataDir = path.join(PROFILES_ROOT, SITE.id);
    fs.mkdirSync(userDataDir, { recursive: true });
    const isFirstRun = fs.readdirSync(userDataDir).length === 0;

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1400, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = context.pages()[0] || (await context.newPage());
    const cfg = GEMINI_SIDEBAR;

    try {
      console.log(`\n=== GEMINI sidebar walk — ${SITE.url} ===`);
      console.log(isFirstRun
        ? 'First run for this profile — log into Google when the browser opens.'
        : 'Profile may already be authenticated — just confirm the sidebar is visible.');
      console.log('Make sure the LEFT chat-history sidebar is visible (expand it if collapsed).');
      console.log('When ready, click Resume in the Playwright Inspector.\n');

      await page.goto(SITE.url, { waitUntil: 'domcontentloaded' });
      await page.pause(); // ← you log in / confirm sidebar, then Resume

      // Wait for the real conversation list to exist.
      await page.waitForSelector(cfg.container, { timeout: 30000 });

      // Scroll the sidebar to load the full lazy list (scroll-until-stable).
      const total = await scrollSidebarUntilStable(page, cfg);
      console.log(`Sidebar stabilized at ${total} conversation items.`);

      // Enumerate with the shipped item selector. Titles come back raw and are
      // normalised here by the extension's own cleanTitle, so this probe sees
      // exactly what the extension would — including the doubled-title collapse
      // (#209) that a local .replace(/\s+/g,' ') would silently miss.
      const raw = await page.evaluate((c) => {
        const scope = document.querySelector(c.container) || document;
        return Array.from(scope.querySelectorAll(c.listItem)).map((el, i) => ({
          listPosition: i,
          rawTitle: (el.querySelector(c.title) && el.querySelector(c.title).textContent) || '',
          url: el.getAttribute(c.urlAttr),
        }));
      }, cfg);
      const rows = raw.map(({ rawTitle, ...r }) => ({
        ...r,
        title: cleanTitle(rawTitle),
        conversationId: parseConversationId(r.url),
      }));

      console.log(`\nEnumerated ${rows.length} conversations. First 8:`);
      rows.slice(0, 8).forEach((r) => console.log(`  [${r.listPosition}] ${r.conversationId}  ${r.title}`));

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.conversationId)).toBe(true);

      // --- SWITCH PROOF: click through the first WALK_COUNT conversations ---
      console.log(`\nSwitching through the first ${WALK_COUNT}:`);
      const walked = [];
      for (let i = 0; i < Math.min(WALK_COUNT, rows.length); i++) {
        const target = rows[i];
        await page.click(`${cfg.listItem}:nth-of-type(${i + 1})`);
        // Confirm the switch: URL now carries this conversation's id.
        await page.waitForURL(new RegExp(`/app/${target.conversationId}`), { timeout: 15000 });
        const landedUrl = page.url();
        const ok = landedUrl.includes(target.conversationId);
        console.log(`  ${ok ? 'OK ' : 'XX '} #${i} → ${target.conversationId}  "${target.title}"  (${landedUrl})`);
        expect(ok).toBe(true);
        walked.push({ ...target, landedUrl });
        await page.waitForTimeout(1200); // let you SEE the main pane change
      }

      // Save the RAW sidebar DOM to a gitignored capture directory (#363).
      // This is the operator's real conversation list; it is not a fixture and
      // must never be written to a tracked path. `tools/scrub-sidebar-fixtures.js`
      // is what turns a capture into something committable, and running it is a
      // deliberate separate step.
      fs.mkdirSync(CAPTURES_DIR, { recursive: true });
      const capturePath = path.join(CAPTURES_DIR, 'sidebar-gemini.html');
      fs.writeFileSync(capturePath, await page.content(), 'utf8');

      console.log(`\nPROOF COMPLETE: enumerated ${rows.length}, switched through ${walked.length}.`);
      console.log(`Raw capture written to ${path.relative(path.join(__dirname, '..', '..'), capturePath)} (gitignored — real titles and ids).`);
      console.log('To refresh the committable fixture from it:');
      console.log('  node tools/scrub-sidebar-fixtures.js data/sidebar-captures\n');
    } finally {
      await context.close();
    }
  });
});

/**
 * Scroll the sidebar's scroll parent until the conversation count stops growing.
 * Returns the stable item count.
 */
async function scrollSidebarUntilStable(page, cfg) {
  let last = -1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const count = await page.evaluate((c) => {
      const scope = document.querySelector(c.container);
      if (!scope) return 0;
      // Scroll the nearest scrollable ancestor to the bottom.
      let node = scope;
      while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
      if (node) node.scrollTop = node.scrollHeight;
      return scope.querySelectorAll(c.listItem).length;
    }, cfg);
    if (count === last) return count;
    last = count;
    await page.waitForTimeout(600);
  }
  return last;
}
