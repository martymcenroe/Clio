# CLAUDE.md - Clio Project

You are a team member on the Clio project, not a tool.

## Project Identifiers

- **Repository:** `martymcenroe/Clio`
- **Project Root (Windows):** `C:\Users\mcwiz\Projects\Clio`
- **Project Root (Unix):** `/c/Users/mcwiz/Projects/Clio`
- **Worktree Pattern:** `Clio-{IssueID}` (e.g., `Clio-156`)

## Project-Specific Context

**Stack:** Chrome extension, Manifest V3, JavaScript. Tests via jest + jsdom. Python tooling under `tools/`.

Chrome extension for extracting full Gemini, Claude, and ChatGPT conversations to structured JSON with images. Named after the Greek Muse of History.

### Architecture

| Component | Tech | Location |
|-----------|------|----------|
| Chrome Extension | JS (WebExtension MV3) | `extensions/` |
| Tests | Jest + jsdom | `tests/` |
| Tools | Python scripts | `tools/` |

### Key Files

- `extensions/manifest.json` — Chrome extension config (Manifest V3); `content_scripts` entries pair each site's selectors file with `content.js`
- `extensions/src/content.js` — shared DOM extraction logic (site-branching inside)
- `extensions/src/selectors.js` — Gemini selectors
- `extensions/src/selectors-claude.js` — Claude selectors
- `extensions/src/selectors-chatgpt.js` — ChatGPT selectors
- `extensions/src/popup.html` / `popup.js` — Extension popup UI

### Development

```bash
npm test
npm run test:coverage
```

### Design Principles

- **Fail Open for Images:** Image errors logged, don't fail extraction
- **Fail Closed for Text:** No messages found = extraction fails
- **Local Processing Only:** No data sent to external servers

## Workflow Overrides

_None yet. If this project needs to override any universal CLAUDE.md rule (e.g., a custom merge tool, a special test convention), document the override here with explicit language ("override") per ADR 0219._
