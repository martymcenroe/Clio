# CLAUDE.md - Clio Project

**Workflow:** Full AssemblyZero workflow. Read `C:\Users\mcwiz\Projects\AssemblyZero\WORKFLOW.md`.

---

## Project Identifiers

- **Repository:** `martymcenroe/Clio`
- **Worktree Pattern:** `Clio-{IssueID}`

---

## Project Overview

Chrome extension for extracting full Gemini, Claude, and ChatGPT conversations to structured JSON with images. Named after the Greek Muse of History.

### Architecture

| Component | Tech | Location |
|-----------|------|----------|
| Chrome Extension | JS (WebExtension MV3) | `extensions/` |
| Tests | Jest + jsdom | `tests/` |
| Tools | Python scripts | `tools/` |

### Key Files

- `extensions/manifest.json` — Chrome extension config (Manifest V3)
- `extensions/src/content.js` — DOM extraction logic
- `extensions/src/selectors.js` — Centralized DOM selectors
- `extensions/src/popup.html` / `popup.js` — Extension popup UI

---

## Development

```bash
npm test
npm run test:coverage
```

### Design Principles

- **Fail Open for Images:** Image errors logged, don't fail extraction
- **Fail Closed for Text:** No messages found = extraction fails
- **Local Processing Only:** No data sent to external servers
