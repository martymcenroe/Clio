# CLAUDE.md - Clio Project

You are a team member on the Clio project, not a tool.

## FIRST: Read AgentOS Core Rules

**Before doing any work, read the AgentOS core rules:**
`C:\Users\mcwiz\Projects\AgentOS\CLAUDE.md`

That file contains core rules that apply to ALL projects.

---

## Project Identifiers

- **Repository:** `martymcenroe/Clio`
- **Project Root (Windows):** `C:\Users\mcwiz\Projects\Clio`
- **Project Root (Unix):** `/c/Users/mcwiz/Projects/Clio`
- **Worktree Pattern:** `Clio-{IssueID}` (e.g., `Clio-42`)

---

## Project Overview

**Clio** is a Chrome extension for extracting full Gemini conversations to structured JSON with images.

Named after the Greek Muse of History - appropriate for preserving conversation history. Also sounds like "clip" for copy-paste.

### Architecture

| Component | Tech | Location |
|-----------|------|----------|
| Chrome Extension | JS (WebExtension MV3) | `extension/` |
| Tests | Jest + jsdom | `test/` |
| Tools | Python scripts | `tools/` |

### Key Files

- `extension/manifest.json` - Chrome extension config (Manifest V3)
- `extension/src/content.js` - DOM extraction logic
- `extension/src/selectors.js` - Centralized DOM selectors
- `extension/src/popup.html` - Extension popup UI
- `extension/src/popup.js` - Popup logic, zip creation
- `extension/src/background.js` - Service worker

---

## Development Workflow

### Running Tests

```bash
npm test
npm run test:coverage
```

### Generating Icons

```bash
poetry run --directory /c/Users/mcwiz/Projects/AgentOS python /c/Users/mcwiz/Projects/Clio/tools/generate_icons.py --transparent
```

### Loading the Extension (Developer Mode)

**Chrome:**
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `C:\Users\mcwiz\Projects\Clio\extension\`

**Edge:**
1. Open `edge://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `C:\Users\mcwiz\Projects\Clio\extension\`

---

## Chrome Web Store Considerations

This extension may be published to the Chrome Web Store.

### Required Icon Sizes

| Size | Required For |
|------|--------------|
| 16px | Favicon |
| 32px | Windows |
| 48px | Extensions page |
| 128px | Chrome Web Store, installation |

### Store Listing Requirements

- Detailed description
- Privacy policy (all data stays local)
- Screenshots
- Promotional images (optional)

---

## Design Principles

### Fail Open for Images

Image extraction errors are logged but do not fail the overall extraction. The JSON transcript is always generated, even if some images fail to download.

### Fail Closed for Text

If no conversation messages can be found, extraction fails with a clear error. Text extraction must succeed.

### Local Processing Only

All data processing happens in the browser. No data is sent to external servers.

---

## GitHub CLI

Always use explicit repo flag:
```bash
gh issue create --repo martymcenroe/Clio --title "..." --body "..."
```

---

## You Are Not Alone

Other agents may work on this project. Coordinate via GitHub Issues.
