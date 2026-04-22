# Clio 2.0 — Personal Conversation Archive

> **Status:** Backlog · Umbrella tracker: #46
> **Scope:** 24 feature issues across 5 epics · 3 MVP gates
> **Working style:** long-running, opportunistic — resume any issue when credits + time + patience align

## Context

Clio today (v1.3.3) extracts a single active conversation from Gemini, Claude, or ChatGPT to a JSON+images ZIP. You click the popup button, the extension captures whatever is in the current tab, and you save the file.

Clio 2.0 evolves this into a **personal LLM archive**. The vision:

- Harvest the sidebar conversation list from 4 accounts (2 Gemini, 1 Claude, 1 ChatGPT — grow slowly, maybe 5 or 6 eventually)
- Full-content extract every conversation into a local database
- Search cross-account and cross-LLM — "find every chat where I discussed scrambled eggs" returns hits from any account on any site
- Keep everything local; no data leaves the browser unless explicitly exported

This is a big shift in Clio's architecture. The backlog below breaks it into 5 epics and 24 issues so it can be picked up piecemeal over weeks or months without losing the thread.

## Architecture decisions (frozen)

These decisions were made in conversation and are not up for revisiting inside individual issues. If one of these needs to change, update this doc first.

- **Storage:** IndexedDB + [flexsearch](https://github.com/nextapps-de/flexsearch) (or [minisearch](https://github.com/lucaong/minisearch)) for full-text search. Escalate to native SQLite via Chrome native messaging only if IndexedDB hits a real wall at scale.
- **Account identity:** manual labels. User adds a label per logged-in account once (e.g. "mcwizard1 — Gemini personal"). No email scraping from site UIs — too brittle.
- **Incremental append:** default behavior, not opt-in. Primary key is `(site, account_label, conversation_id)`. Full-extraction only touches rows where `content_extracted_at IS NULL`. First harvest per account = full sweep; every harvest after = delta. A manual "force re-extract" flag exists for deliberately refreshing one conversation.
- **DOM discovery:** headed Playwright with pause-for-login, not DevTools snippet iteration. Four logins total — once per account. Scripts dump sidebar structure + account-menu DOM + per-conversation URL scheme + lazy-load behavior, and save real HTML as test fixtures. This resolves the "40 DevTools retries" pain from earlier DOM work.
- **Test fixtures must mirror real DOM.** Captured in `feedback_verify_dom_extraction.md` memory. F1's Playwright outputs become the fixtures; selector tests assert cardinality matches observed counts.

## MVP gates

Each MVP is a complete user-visible capability shipped as a named release.

| MVP | Release | Epics required | Capability |
|-----|---------|----------------|------------|
| **MVP1 — Counting works** | v1.4.0 · "Sidebar Harvest" | E1 + E2 | User harvests each of 4 accounts, sees per-account and cross-account conversation counts, has a searchable title index |
| **MVP2 — Titles searchable** | v1.5.0 · "Archive Search" | + E3 | Viewer page with site/account/date filters, title search across all harvested conversations |
| **MVP3 — "Scrambled eggs" search** | v1.6.0 · "Archive Deep" | + E4 | Full content indexed; search returns message-body hits across sites and accounts |

Enrichment (E5) floats after MVP3.

## Epics

### E1 — Foundation · label `epic:foundation`

Gates everything downstream. **F1 is the sidewide unlock** — without real DOM dumps, every selector issue downstream is guesswork.

| ID | Title | Issue | Blocked by |
|----|-------|-------|------------|
| F1 | Playwright DOM-discovery harness | #47 | — |
| F2 | IndexedDB schema + versioned migrations | #48 | — |
| F3 | Account-labels UI in popup | #49 | F2 |
| F4 | Harvest-state persistence | #50 | F2 |

F1 produces `docs/dom-dumps/{gemini,claude,chatgpt}.json` + real sidebar HTML fixtures in `tests/fixtures/sidebar-{site}.html`. F2 creates tables: `accounts`, `conversations`, `harvest_runs`, `extraction_queue`. F3 is the manual account-labels UI. F4 persists rate-limit config and last-harvest timestamps.

### E2 — Sidebar harvest · label `epic:sidebar-harvest` — **MVP1**

| ID | Title | Issue | Blocked by |
|----|-------|-------|------------|
| S1 | Sidebar selector blocks in `selectors-{gemini,claude,chatgpt}.js` | #51 | F1 |
| S2 | Generalize `scrollToLoadAllMessages` into scroll-until-stable utility + sidebar scroller | #52 | F1 |
| S3 | `enumerateConversations(site)` — metadata extraction with upsert | #54 | S1, S2, F2, F3 |
| S4 | "Harvest list" popup button with delta reporting | #55 | S3 |
| S5 | Sidebar regression test suite | #53 | S1, F1 |
| S6 | Multi-account and cross-account conversation counts in popup | #56 | S3, S4 |

**Release:** v1.4.0 once S1–S6 merge. User can harvest each of 4 accounts and see counts.

### E3 — Search UI · label `epic:search` — **MVP2**

| ID | Title | Issue | Blocked by |
|----|-------|-------|------------|
| U1 | Viewer "Archive" page with site / account / date filters | #57 | F2 (data once S3 populates) |
| U2 | Title substring search over stored conversations | #58 | U1, S3 |
| U3 | Upgrade title search to FTS (flexsearch) | #59 | U2 |

**Release:** v1.5.0 after U1 + U2. U3 can slip to v1.5.1 if FTS isn't needed day one.

### E4 — Full-content harvest · label `epic:full-extraction` — **MVP3**

| ID | Title | Issue | Blocked by |
|----|-------|-------|------------|
| C1 | Batch queue + worker — opens each pending conversation, runs existing per-site extractor, stores in IndexedDB | #60 | S3, F2 |
| C2 | Incremental-append logic — only enqueue conversations where `content_extracted_at IS NULL` | #61 | C1 |
| C3 | Rate-limit + configurable pacing with exponential backoff | #62 | C1 |
| C4 | Progress UI in popup with pause / resume / cancel | #63 | C1 |
| C5 | Per-conversation error triage with retry-one / retry-all-failed | #64 | C1 |
| C6 | Extend search index to message body text | #65 | C1, U2 |

**Release:** v1.6.0 after C1–C6. "Scrambled eggs" search lands here.

### E5 — Enrichment + portability · label `epic:enrichment-portability`

Floats after MVP3. None of these is gating.

| ID | Title | Issue | Blocked by |
|----|-------|-------|------------|
| T1 | Content-based timestamp extraction (`first_message_at`, `last_message_at`) | #66 | C1 |
| T2 | List-position recency proxy as fallback sort | #67 | S3 |
| X1 | JSON-on-disk export — organized tree `{account}/{site}/{id}.json` + images + manifest | #68 | F2 |
| X2 | Import from disk dump — reseed a fresh Chrome profile | #69 | X1 |
| X3 | Settings page — rate limits, clear-DB confirm, export / import buttons | #70 | F4 |

## Dependency graph

```
                F1 ─┬─ S1 ─┐
                    │      ├─ S3 ─ S4 ─ S6 ───────[MVP1: v1.4.0]
                    │      │
                    ├─ S2 ─┘
                    │
                    └─ S5

F2 ─┬─ F3 ───────── S3 (shared)
    ├─ F4 ────────────────────── X3
    ├─ X1 ─ X2
    └─ U1 ─ U2 ─────────────────[MVP2: v1.5.0]
                │
                U3
                │
                C6 ─────────────[MVP3: v1.6.0]
                ↑
         C1 ─┬─ C2
             ├─ C3
             ├─ C4
             └─ C5

C1 ─ T1
S3 ─ T2
```

## Reuse anchors

Existing code the new work should build on, not replace:

| Target | Location | Reused by |
|--------|----------|-----------|
| `scrollToLoadAllMessages()`, `findScrollContainer()`, `waitForLoadingComplete()`, `SCROLL_CONFIG` | `extensions/src/content.js:339+` | S2 (extracted as generic util), S3 |
| Per-site selectors pattern (3 files, site-specific shape) | `extensions/src/selectors.js`, `selectors-claude.js`, `selectors-chatgpt.js` | S1 adds `sidebar.*` block to each |
| `@playwright/test@1.40.0`, empty `tests/e2e/` | `package.json`, `tests/e2e/.gitkeep` | F1 populates this directory |
| Per-site extractors (`extractTurnsClaude`, `extractTurnsGemini`, `extractTurnsChatGPT`, etc.) | `extensions/src/content.js` | C1 invokes unmodified |
| Issue body convention (`## Problem` / `## Proposal` / `## Acceptance`) | Issues #37, #39 | All 24 feature issues |
| DOM-first rule | `memory/feedback_verify_dom_extraction.md` | F1, S1, S5 enforce mechanically |

## Working this backlog

- **Find open issues:** `gh issue list --repo martymcenroe/Clio --label clio-2.0 --state open`
- **Check readiness:** each issue's `## Dependencies` section lists blockers. Start only with issues whose blockers are closed.
- **Issue IDs in this doc** (F1, S3, etc.) are stable handles. Underlying GitHub issue numbers are assigned once and do not change.
- **Versioning policy** (from runbook §Versioning): every PR touching `extensions/` bumps `extensions/manifest.json`. Patch for bugfix, minor for feature, major for breaking schema change.
- **Test-fixture rule:** no DOM-extraction fix lands without a real-DOM fixture. F1 is the harness that produces them. See `memory/feedback_verify_dom_extraction.md`.

## Changelog

- **2026-04-22** — Initial scaffolding. Roadmap doc + 24 feature issues + umbrella #46 + 6 labels. No code changes. See docs PR.
