# CLAUDE.md - Clio Project

You are a team member on the Clio project, not a tool.

---

## COMPACTION-SAFE RULES (NEVER SUMMARIZE AWAY)

**These rules MUST survive context compaction. They are non-negotiable constraints.**

### BASH COMMAND CONSTRAINTS (HARD REQUIREMENTS)

```
BANNED:     &&    |    ;    cd X && command
REQUIRED:   One command per Bash call, absolute paths only
```

| WRONG | CORRECT |
|-------|---------|
| `cd /path && git status` | `git -C /path status` |
| `cat file.txt` | Use `Read` tool |
| `grep pattern file` | Use `Grep` tool |
| `cmd1 && cmd2 && cmd3` | 3 parallel Bash calls |

**If you are about to type `&&` in a Bash command, STOP and rewrite.**

### PATH FORMAT CONSTRAINTS

| Tool | Format | Example |
|------|--------|---------|
| Bash | Unix `/c/...` | `/c/Users/mcwiz/Projects/Clio/...` |
| Read/Write/Edit/Glob | Windows `C:\...` | `C:\Users\mcwiz\Projects\Clio\...` |

**NEVER use `~` - Windows doesn't expand it.**

### DANGEROUS PATH CONSTRAINTS (I/O SAFETY)

**NEVER search or traverse these paths:**

| Path | Risk |
|------|------|
| `C:\Users\mcwiz\OneDrive\` | CRITICAL - triggers massive cloud downloads |
| `C:\Users\mcwiz\` (root) | HIGH - contains OneDrive, AppData |
| `C:\Users\mcwiz\AppData\` | HIGH - hundreds of thousands of files |

**Always scope searches to `C:\Users\mcwiz\Projects\` or narrower.**

### VISIBLE SELF-CHECK PROTOCOL (MANDATORY)

**Every Bash call requires visible self-checking:**

```
**Bash Check:** `[the command]`
**Scan:** [&&, |, ;, cd at start?] → [CLEAN or VIOLATION]
**Action:** [Execute, Rewrite, or Use Read/Grep/Glob instead]
```

### WORKTREE ISOLATION RULE (CRITICAL)

**ALL code changes MUST be made in a worktree. NEVER commit code directly to main.**

**What requires a worktree:**
- ANY change to `.js`, `.html`, `.css`, `.json` files
- Bug fixes, even "quick" ones

**What can be committed directly to main:**
- Documentation files (`docs/**/*.md`)
- `CLAUDE.md` updates

**Worktree creation pattern:**
```bash
git worktree add ../Clio-{IssueID} -b {IssueID}-short-desc
git -C ../Clio-{IssueID} push -u origin HEAD
```

### COMPACTION DETECTION (AUTO-REFRESH)

**If you see "This session is being continued from a previous conversation" or similar compaction signals, run `/onboard --refresh` IMMEDIATELY.**

---

## Full AgentOS Reference

For complete rules (Gemini gates, destructive command constraints, etc.):
`C:\Users\mcwiz\Projects\AgentOS\CLAUDE.md`

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
| Chrome Extension | JS (WebExtension MV3) | `extensions/` |
| Tests | Jest + jsdom | `tests/` |
| Tools | Python scripts | `tools/` |

### Key Files

- `extensions/manifest.json` - Chrome extension config (Manifest V3)
- `extensions/src/content.js` - DOM extraction logic
- `extensions/src/selectors.js` - Centralized DOM selectors
- `extensions/src/popup.html` - Extension popup UI
- `extensions/src/popup.js` - Popup logic, zip creation
- `extensions/src/background.js` - Service worker

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
