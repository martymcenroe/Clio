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

## Testing

### Unit Tests (Jest)

```bash
npm test                    # Run all unit tests
npm run test:coverage       # Run with coverage report
npm run test:watch          # Run in watch mode
```

**Test files:**
- `tests/content.test.js` - Content script extraction tests
- `tests/popup.test.js` - Popup UI and download tests
- `tests/background.test.js` - Service worker tests
- `tests/viewer.test.js` - Viewer component tests
- `tests/image-extraction.test.js` - Image handling tests
- `tests/message-passing.test.js` - Chrome messaging tests
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
2. Refresh the Gemini page
3. Try extraction again

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
