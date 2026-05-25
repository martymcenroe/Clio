# Changelog

All notable changes to Clio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.1] — 2026-05-25

Pre-submission cleanup release. `v1.4.0` was tagged but never submitted to the Chrome Web Store — pre-flight surfaced two unnecessary `console.log` calls in the background service worker. They do not violate the privacy policy (local console output, never transmitted), but they present a confusing surface for a reviewer auditing a strict-local extension. `v1.4.1` ships without them.

### Removed
- `console.log` for the `chrome.runtime.onInstalled` install/update event (#151)
- `console.log` for the `chrome.downloads.onChanged` completion event (#151)

### Changed
- Background-service-worker listener bodies reduced to no-op stubs after the debug logs were removed; listener registrations remain because the manifest declares them (#151)
- `tests/background.test.js` updated to assert the handlers stay silent rather than asserting log output (#151)

## [1.4.0] — 2026-05-24

The Chrome Web Store launch release. **Tagged but never submitted** — superseded by 1.4.1.

### Added
- Repository hygiene: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, GitHub issue and PR templates
- `PRIVACY.md` and `docs/privacy.html` — strict-local privacy policy hosted at `cliocast.com/privacy`
- GitHub Pages landing site and the Cloudflare-Pages-deployed `cliocast.com` landing
- GitHub Wiki content covering AI governance, data sovereignty, threat model, and defense in depth
- ADR-0201 — system Chrome channel for Playwright against anti-automation-gated sites
- Playwright DOM-discovery harness (sidebar, account-menu, URL schemes) with persistent browser profiles
- Roadmap document: Clio 2.0 personal conversation archive initiative
- Release tooling: `tools/build_release.py` produces CWS-ready ZIPs
- `scripting` permission, used solely as a recovery path to re-inject Clio's content script when a tab loaded before the extension was installed (#139, #145)
- `host_permissions` for `*.googleusercontent.com/*` so Gemini's user-uploaded images make it into the ZIP (#141, #146)
- Popup warning row when one or more images failed to fetch (#141, #146)
- CWS listing copy drafted in `docs/listing-copy.md` with permission justifications for every declared permission
- Chrome Web Store publishing runbook `docs/runbooks/30002-chrome-web-store-publish.md`
- Cloudflare Pages setup runbook `docs/runbooks/30003-cloudflare-pages-setup.md` and `tools/build_site.py` for the `dist/site/` build pattern
- Two CWS listing screenshots at 1280×800 (lighthouse-keeper board game conversation) in `docs/assets/store/` (#92)
- `tools/resize_screenshot.py` — convert any screenshot to CWS listing dimensions

### Changed
- Repository description and topics refreshed to reflect Gemini + Claude + ChatGPT support
- Removed per-repo security hooks (now managed globally)
- **ChatGPT:** selectors modernized — `[data-message-author-role]` replaces the deprecated `article[data-turn]` (#116, #118)
- **Claude:** selectors modernized — `.font-claude-response` replaces the brittle `.row-start-2` (#114, #119)
- **Gemini:** selectors stability verified across Jan–May DOM samples; rationale documented inline (#115, #121)

### Fixed
- **Claude:** Artifact widget chrome (button labels like "Send via Gmail", missing separators) stripped from email-card artifacts (#43, #120)
- **Popup:** Progress badge moved from `top: 20px` to `bottom: 20px` so it no longer overlaps the extension popup (#140, #143)
- **Popup:** Stats card hides on cross-site navigation — no more Gemini stats appearing on a ChatGPT tab (#138, #144). Cross-conversation gating tracked separately (#147, #148, superseded by #149)
- **Popup:** Auto-recover from "Receiving end does not exist" by re-injecting the content script, with a friendly error if recovery fails (#139, #145)

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
