# Gemini Operational Protocols - Clio

## FIRST: Read Core Rules

**Before doing any work, read the AgentOS core rules:**
`C:\Users\mcwiz\Projects\AssemblyZero\CLAUDE.md`

That file contains core rules that apply to ALL projects and ALL agents:
- Bash command rules (no &&, |, ;)
- Path format rules (Windows vs Unix)
- Worktree isolation rules
- Decision-making protocol

---

## 2. Execution Rules

- **Authority:** `AgentOS:standards/0002-coding-standards` is the law for Git workflows.
- **One Step Per Turn:** Provide one distinct step, then wait for confirmation.
- **Check First:** Verify paths/content before changing them.
- **Copy-Paste Ready:** No placeholders. Use heredocs for new files.

---

## 3. Clio Context

**Project:** Clio (Gemini Conversation Harvester)
**Repository:** martymcenroe/Clio
**Project Root (Windows):** `C:\Users\mcwiz\Projects\Clio`
**Project Root (Unix):** `/c/Users/mcwiz/Projects/Clio`

Read `README.md` for project overview.

**Architecture:**
- Chrome Extension: `extensions/` (Chrome only, MV3)
- Viewer: `viewer/` (standalone HTML viewer)
- Tests: `tests/` (Jest + Playwright)

---

## 4. Session Logging

At session end, append a summary to `docs/session-logs/YYYY-MM-DD.md`:
- **Day boundary:** 3:00 AM CT to following day 2:59 AM CT
- **Include:** date/time, model name (from handshake), summary, files touched, state on exit

---

## 5. You Are Not Alone

Other agents (Claude, human orchestrators) work on this project. Check `docs/session-logs/` for recent context before starting work.
