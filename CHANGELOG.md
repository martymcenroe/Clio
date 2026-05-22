# Changelog

All notable changes to Clio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — 1.4.0

The Chrome Web Store launch release. Track progress on the [`chrome-web-store`](https://github.com/martymcenroe/Clio/issues?q=label%3Achrome-web-store) label.

### Added
- Repository hygiene: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, GitHub issue and PR templates
- `PRIVACY.md` and `docs/privacy.html` — strict-local privacy policy
- GitHub Pages landing site (`docs/index.html`) hosting the privacy policy URL for the CWS listing
- GitHub Wiki content covering AI governance, data sovereignty, threat model, and defense in depth
- ADR-0201 — system Chrome channel for Playwright against anti-automation-gated sites
- Playwright DOM-discovery harness (sidebar, account-menu, URL schemes) with persistent browser profiles
- Roadmap document: Clio 2.0 personal conversation archive initiative
- Release tooling: `tools/build_release.py` produces CWS-ready ZIPs

### Changed
- Repository description and topics refreshed to reflect Gemini + Claude + ChatGPT support
- Removed per-repo security hooks (now managed globally)

---

## [1.3.3] — 2026-04-18

### Fixed
- **Claude:** Only remove outer `.row-start-1` so the nested response body is preserved during artifact-turn extraction (#42)

## [1.3.2] — 2026-04-18

### Changed
- Reverted 1.3.1 — the commentary-capture attempt regressed extraction for non-artifact Claude turns. See PR #41 for context.

## [1.3.1] — 2026-04-18 *(reverted in 1.3.2)*

### Fixed
- **Claude:** Attempted to capture commentary prose on artifact turns (#40 — superseded by 1.3.3)

## [1.3.0] — 2026-04-18

### Added
- **Claude:** Mark thinking-only assistant turns explicitly in the JSON output (#38)

---

## [1.2.1] — 2026-04-18

### Added
- Versioning policy documentation and centralized manifest-bump process (#36)

### Fixed
- **Claude:** Enumerate assistant turns by `.row-start-2` rather than `action-bar-copy` (#33)
- Troubleshooting ladder for "Receiving end does not exist" errors (#31)
- **Claude:** Scope assistant-turn extraction to per-message container (#26)
- Removed model override that downgraded Opus from 1M to 256K context (#24)

### Documentation
- Refresh for Gemini + Claude + ChatGPT support; fix dead link; add dev-reload section (#28)

---

## [1.2.0] — 2026-02-28

### Added
- **ChatGPT** (`chatgpt.com`) conversation extraction (#16)

## [1.1.0] — 2026-02-28

### Added
- **Claude.ai** (`claude.ai`) conversation extraction (#13)

---

## [1.0.0] — 2026-01-19 *(approximate; pre-CHANGELOG era)*

Initial Clio release targeting Google Gemini (`gemini.google.com`). All version stamps prior to 1.1.0 are consolidated here — patch numbers from this era were not retroactively recoverable.

### Added
- Gemini conversation extraction with full DOM walk
- Auto-scroll to load all messages before extraction (rewritten with MutationObserver, v2.0)
- Conversation viewer tool — drag-and-drop JSON browsing (#1)
- Standalone JSZip bundling; conversation-area-scoped expand
- User/assistant turn separation in extracted JSON
- Real-time scroll logging for diagnostic visibility
- Unit tests and project documentation
- Selector verification against live Gemini DOM
- Icon assets with true transparency

### Fixed
- Multiple auto-scroll timing and reliability fixes (scroll delay, mutation timeout, loading-indicator detection)
- `countMessages` counts individual messages, not containers
- Test path correction (`test/` → `tests/`, `extension/` → `extensions/`)

### Documentation
- Initial CLAUDE.md, AgentOS rules, project structure standardization
- File inventory; flat reports structure

---

[Unreleased]: https://github.com/martymcenroe/Clio/compare/v1.3.3...HEAD
[1.3.3]: https://github.com/martymcenroe/Clio/releases/tag/v1.3.3
[1.3.2]: https://github.com/martymcenroe/Clio/releases/tag/v1.3.2
[1.3.1]: https://github.com/martymcenroe/Clio/releases/tag/v1.3.1
[1.3.0]: https://github.com/martymcenroe/Clio/releases/tag/v1.3.0
[1.2.1]: https://github.com/martymcenroe/Clio/releases/tag/v1.2.1
[1.2.0]: https://github.com/martymcenroe/Clio/releases/tag/v1.2.0
[1.1.0]: https://github.com/martymcenroe/Clio/releases/tag/v1.1.0
[1.0.0]: https://github.com/martymcenroe/Clio/releases/tag/v1.0.0
