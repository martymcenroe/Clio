# Clio Runbook

Development and operations guide for the Clio Chrome extension.

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests |
| `npm run test:coverage` | Run unit tests with coverage report |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:all` | Run all tests (unit + E2E) |
| `npm run build:viewer` | Build the standalone viewer |

## Development Setup

### Prerequisites

- Node.js 18+
- Python 3.10+ with Poetry (for icon generation)

### Installation

```bash
npm install
npx playwright install  # For E2E tests
```

### Loading the Extension

**Chrome:**
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extensions/` folder

**Edge:**
1. Open `edge://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extensions/` folder

### Dev Reload Loop

After you change code under `extensions/`, reload the extension so Chrome picks up the new source:

1. Open `chrome://extensions`
2. Click the reload icon on the Clio card (circular arrow)
3. Refresh the open conversation tab (`gemini.google.com`, `claude.ai`, or `chatgpt.com`) — the content script re-injects on navigation
4. Re-run the extraction

If the popup still shows stale behavior after a reload, inspect the service worker logs via the "Inspect views: service worker" link on the Clio card.

### Versioning policy

Any commit that changes files under `extensions/` MUST bump `extensions/manifest.json` `version`:

- Bugfix → patch bump (e.g. 1.2.0 → 1.2.1)
- New feature (new site, new extraction field, new UI) → minor bump (e.g. 1.2.x → 1.3.0)
- Breaking change to output schema → major bump (e.g. 1.x.x → 2.0.0)

Rationale: Chrome's `chrome://extensions` card displays this version. Without a bump, a user cannot visually confirm that a reload actually picked up the new code, which makes "did my fix land?" debugging much harder (see issue #35 for the incident that motivated this rule).

Docs-only PRs (no `extensions/` changes) do NOT bump the version.

## Testing

### Unit Tests (Jest)

```bash
npm test                    # Run all unit tests
npm run test:coverage       # Run with coverage report
npm run test:watch          # Run in watch mode
```

**Test files:**
- `tests/content.test.js` - Gemini content script extraction tests
- `tests/content-claude.test.js` - Claude content script extraction tests
- `tests/content-chatgpt.test.js` - ChatGPT content script extraction tests
- `tests/popup.test.js` - Popup UI and download tests
- `tests/background.test.js` - Service worker tests
- `tests/viewer.test.js` - Viewer component tests
- `tests/image-extraction.test.js` - Image handling tests
- `tests/message-passing.test.js` - Chrome messaging tests
- `tests/auto-scroll.test.js` - Auto-scroll / lazy-load tests
- `tests/large-conversation.test.js` - Large-conversation handling tests
- `tests/progress-expansion.test.js` - Thinking / reasoning expansion tests
- `tests/integration/` - Integration tests

**Coverage thresholds:** 80% for branches, functions, lines, and statements.

### E2E Tests (Playwright)

```bash
npm run test:e2e            # Run E2E tests (headless)
npm run test:e2e:headed     # Run E2E tests (visible browser)
```

E2E tests run against Chromium and Firefox. Some tests are skipped on Firefox due to:
- Clipboard permission limitations
- DataTransfer API differences

### Full Test Suite

```bash
npm run test:all            # Unit tests + E2E tests
```

## Project Structure

```
Clio/
├── extensions/
│   ├── manifest.json       # Chrome extension manifest (MV3)
│   ├── src/
│   │   ├── content.js      # DOM extraction logic
│   │   ├── selectors.js    # Centralized DOM selectors
│   │   ├── popup.html      # Extension popup UI
│   │   ├── popup.js        # Popup logic, zip creation
│   │   └── background.js   # Service worker
│   └── icons/              # Extension icons
├── viewer/
│   ├── viewer.html         # Built viewer (generated)
│   ├── viewer.template.html
│   ├── viewer-logic.js
│   └── build.js
├── tests/
│   ├── fixtures/           # Test HTML/JSON fixtures
│   ├── setup.js            # Jest setup with Chrome mocks
│   └── *.test.js           # Test files
└── tools/
    └── generate_icons.py   # Icon generation script
```

## Key Workflows

### Adding New DOM Selectors

1. Add selector to `extensions/src/selectors.js`
2. Update extraction logic in `extensions/src/content.js`
3. Add test fixture to `tests/fixtures/`
4. Write tests in `tests/content.test.js`

### Updating the Viewer

1. Edit `viewer/viewer.template.html` (HTML structure)
2. Edit `viewer/viewer-logic.js` (JavaScript logic)
3. Run `npm run build:viewer` to regenerate
4. Test with `npm run test:e2e`

### Generating Icons

```bash
poetry run --directory /c/Users/mcwiz/Projects/AgentOS \
  python /c/Users/mcwiz/Projects/Clio/tools/generate_icons.py --transparent
```

Required sizes: 16px, 32px, 48px, 128px

### DOM Discovery (Clio 2.0 — F1, issue #47)

Clio 2.0 harvests conversation lists from the sidebars of Gemini, Claude, and ChatGPT. Selectors for those sidebars are derived from real-DOM dumps produced by the Playwright harness in `tests/e2e/dom-discovery.spec.js`. Run the harness whenever:

- You are starting work on sidebar-harvest issues (#51, #53) and need fresh fixtures
- A site ships a UI change that breaks sidebar harvesting

#### Prerequisites

- **System Chrome installed.** The harness uses `channel: 'chrome'` to launch your real Chrome install, not Playwright's bundled Chromium. Google's anti-automation fingerprinting blocks sign-in on bundled Chromium with "This browser or app may not be secure" — the Chrome channel is friendlier. On Windows, any standard Chrome install works; no extra setup.

#### Persistent login profiles

Each site's login is cached to disk so **you only log in once per site, forever** (until you explicitly clear the profile):

- Profile location: `~/.clio-profiles/{gemini,claude,chatgpt}/` (outside the repo; survives reclones)
- First run for a site: Chrome opens on a fresh profile, you log in manually
- Subsequent runs: Chrome opens, profile is already authenticated, the site loads straight to the conversation list
- Clear one site to force re-login: `rm -rf ~/.clio-profiles/{site}/`
- Clear all: `rm -rf ~/.clio-profiles/`

If a site ships a change that invalidates saved sessions (forced logout, security alert), you'll see the login page on next run; log in again and the profile re-authenticates.

#### Running the harness

```bash
npm run test:e2e:dom-discovery
```

The `--debug` flag baked into this script forces the **Playwright Inspector** to open. That's what gives you the Resume button you'll need to hand control back to the script.

**What you'll see** — the command opens **two separate windows**:

1. **Chrome browser** — a normal-looking browser window. Starts at `about:blank`, then navigates to the target site. On first run, you'll see the site's login page. On subsequent runs, you'll land in the logged-in conversation list directly.
2. **Playwright Inspector** — a smaller window alongside the browser. Looks like a debugger: a toolbar across the top with playback controls (▶ Resume, ⏸ Pause, step-over), and a panel showing the paused line of script.

The **Resume** button is the large green play triangle (▶) at the left of the Inspector's toolbar, keyboard shortcut **F8**. Clicking it tells the paused script "OK, proceed."

**You will click Resume twice per site** because `--debug` mode pauses once at the start of the test AND again at the explicit `await page.pause()` line:

1. Chrome opens at `about:blank`; Inspector is paused before the first `page.goto` line
2. **Click ▶ Resume (or F8)** — the browser navigates to the site
3. **First run:** log into the site. **Subsequent runs:** verify the conversation-list sidebar is visible (expand it if collapsed). Either way, the script is now paused at `page.pause()`.
4. **Click ▶ Resume again** — the analysis runs on the live page, writes outputs, closes the browser, and opens the next site
5. Repeat the two-click pattern for each remaining site

Expected runtime on first run: ~5–10 minutes (mostly manual login). Subsequent runs: ~1–2 minutes (no login, just clicking Resume and waiting for analysis).

#### Outputs

- `docs/dom-dumps/{gemini,claude,chatgpt}.json` — structured report:
  - `scrollableContainers` — every scrollable with child-count and class fingerprints
  - `mostLikelySidebar` — best match by repeated-child-fingerprint score
  - `accountMenuCandidates` — avatars / account triggers (for #49 labels UI)
  - `lazyLoad` — how child count progresses as the sidebar scrolls
  - `urlScheme` — URL before/after clicking the first sidebar item (for conversation-id parsing in #51)
- `tests/fixtures/sidebar-{gemini,claude,chatgpt}.html` — full page HTML snapshots consumed by S5's jsdom regression tests (#53)

#### Before committing

Dumps and fixtures contain real data from your account. Before `git add`:

- **Scan for sensitive content:** conversation titles may be private. Either (a) sanitize titles in the HTML with find-and-replace, or (b) gitignore the specific fixture and commit a curated minimal sample.
- **Scan for tokens:** full-page HTML may include hidden inputs with CSRF tokens. `grep -Ei "token|csrf|bearer|authorization" tests/fixtures/sidebar-*.html` to audit. Session tokens are harmless after logout but some reviewers prefer them stripped.

#### Troubleshooting

- **Inspector window doesn't open:** The `test:e2e:dom-discovery` script passes `--debug`, which is what triggers Inspector. If only the browser opens and you see no separate control window, confirm you ran `npm run test:e2e:dom-discovery` (not the plain `npm run test:e2e`). Running `PWDEBUG=1 npm run test:e2e -- dom-discovery` is an equivalent fallback. If neither works, your Playwright install may be missing its inspector UI — try `npx playwright install` to refresh.
- **"Target closed" during `page.pause()`:** You closed the Inspector window before clicking Resume. Re-run; leave the Inspector open until the whole spec finishes (it closes automatically at the end).
- **Google sign-in still blocks with "browser may not be secure":** The harness already uses `channel: 'chrome'` + `--disable-blink-features=AutomationControlled` to dodge this. If it still fires, possibilities: (a) no system Chrome installed — install Chrome and retry; (b) a custom Chrome policy is disallowing automation — check `chrome://policy` for `BrowserSignin` / `RemoteDebuggingAllowed` restrictions; (c) Google is escalating — try launching with a persistent user-data-dir so you're recognized as a returning user (would require spec changes).
- **"Chrome browser not found" at launch:** `channel: 'chrome'` requires a system Chrome install. On Windows, install Chrome from https://www.google.com/chrome/ and retry.
- **No scrollable containers detected:** the sidebar is hidden or collapsed in the page when you clicked Resume. Expand it first, then re-run.
- **`mostLikelySidebar` is null in the JSON:** the heuristic requires at least 5 children with the same class fingerprint. If the sidebar has fewer items or uses per-item randomized classes, fall back to the `scrollableContainers` list in the dump and pick the candidate manually.
- **Harness failed and the terminal scrolled away before you could read it:** the spec records trace + video on every run (#79). Open the trace to replay what happened:
  ```bash
  # Find the latest failure's test-results directory
  ls -lt tests/../test-results/ | head -3
  # Open the trace (opens in a browser-based viewer)
  npx playwright show-trace test-results/<your-failed-test-dir>/trace.zip
  ```
  The viewer shows a timeline of every Playwright action with before/after DOM snapshots, network, and console. Video lives in the same directory as `video.webm`. If `dumpSite()` threw, `docs/dom-dumps/{site}.json` will contain `{ error, stack, timestamp }` instead of analysis data — check there first before opening the trace.

## Troubleshooting

### Content Script Not Loaded

If extraction fails with "Content script not loaded":
1. Reload the extension in `chrome://extensions`
2. Refresh the conversation page (Gemini, Claude, or ChatGPT)
3. Try extraction again

### "Could not establish connection. Receiving end does not exist."

This Chrome runtime error appears in the popup when it calls `chrome.tabs.sendMessage` but no content script is listening in the active tab. Almost always it means the extension was reloaded but the conversation tab wasn't — the tab still holds the stale, now-orphaned content script.

Try the steps in order; stop when the error clears:

1. **Hard-refresh the conversation tab** (Ctrl+Shift+R). The content script only injects on navigation, so a refresh pulls in the current version. Fixes this ~90% of the time.
2. On `chrome://extensions`, confirm Clio is **enabled** and the version shown matches `extensions/manifest.json`. Click the reload icon on the Clio card, then hard-refresh the tab again.
3. Still failing? Open DevTools on the conversation tab (F12) → Console. Look for red errors mentioning `content.js`, `selectors.js`, `selectors-claude.js`, or `selectors-chatgpt.js`. A thrown error during content-script injection silently prevents the message listener from registering — fix the underlying error and reload.

### Streaming Response Detection

The extension waits for streaming to complete. If it detects streaming:
- A "Stop" button is visible
- There's a streaming indicator class

### Image Extraction Failures

Image extraction uses "fail open" - errors are logged but don't fail extraction:
- Check `metadata.extractionErrors` in the JSON output
- Cross-origin images may fail to download
- Very large images may timeout

## Chrome Web Store

### Required Assets

| Asset | Size | Purpose |
|-------|------|---------|
| Icon | 16px | Favicon |
| Icon | 32px | Windows |
| Icon | 48px | Extensions page |
| Icon | 128px | Chrome Web Store |
| Screenshot | 1280x800 | Store listing |
| Promo tile | 440x280 | Store listing (optional) |

### Privacy Policy

All data processing is local. No data is transmitted to external servers.
