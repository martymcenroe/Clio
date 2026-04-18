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
