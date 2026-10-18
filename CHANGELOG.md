# Changelog

All notable changes to Clio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.9.7] — 2026-10-18

### Fixed
- A Gemini generated image is captured at full size where it can be had. Gemini shows it from Google's image service capped at 1024 px (`…/gg/<token>=s1024-rj`: measured 1024×559, 16,227 bytes) where its own "Download full size image" gives 1408×768, 321,273 bytes; the same URL with `=d-I`, as that download asks, is fetched first. The page swaps the image's src for a `blob:` URL once it is on screen, so the content script remembers each swap from the moment it loads (#425)

### Added
- `attachment.rendition` and `metadata.imagesReduced`: an image captured as the site's own reduced copy, where the original could not be had, is marked (`"preview"`, `"display"`), counted, and named in `incompleteReasons`, so a smaller or lossy copy cannot pass for the image. On Claude, an upload seen after a page load is shown from `/files/<id>/preview` (a 512×512 PNG upload came back as a 6,006-byte lossy WebP), Claude's own viewer shows the same copy, and no endpoint for the original was found, so it is marked (#420). On Gemini, a displayed copy is marked when the full size cannot be fetched (#425)
- Measured for #425: ChatGPT's generated image, as Clio captures it, is byte-identical to ChatGPT's own download (1254×1254 PNG, 1,186,331 bytes)

## [1.9.6] — 2026-10-18

Gemini is measured for the first time (#309), and every site's text keeps its paragraphs.

### Fixed — every site
- Paragraphs, list items, headings and table rows no longer run together in exported text. `extractTextContent()` read `textContent`, which puts nothing between two elements, so a boundary survived only where the page left whitespace there. Measured live: ChatGPT left none at 200 of 200 adjacent blocks, Gemini at 3 of 3, Claude at 3 of 50; a 162-message ChatGPT export ran sentences together at 621 places in 62 of 77 replies. Adjacent blocks now get a blank line (paragraphs, headings, lists, quotes, tables) or a newline (list items, rows, `div`s), cells within a row " | ", and a `<br>` a newline, only where the page has no whitespace of its own, so Claude's mostly spaced text is left as it was. On the same ChatGPT conversation, 0 such places remain (#426)
- A code fence no longer ends in a blank line when the code ends in a newline (#422)

### Fixed — Gemini
- Messages no longer carry Gemini's screen-reader headings. Each prompt began "You said" followed by a truncated copy of itself and then the prompt, and each reply began "Gemini said". Elements with `cdk-visually-hidden` are left out of the text, and a prompt is read line by line from `p.query-text-line`, so a prompt typed on three lines keeps its three lines (#421)
- A code block's language label is no longer the first line of its code ("Bash#!/bin/bash"). The `<code-block>` element, header and buttons included, is replaced by the fence, and the code is read from its `pre > code` (#422)
- An export is titled with the conversation's title, not the mode picker's "Auto". Matches inside the mode picker and screen-reader headings are skipped, and `document.title` loses its current " - Google Gemini" suffix; a page titled only "Gemini" or "Google Gemini" is "Untitled Conversation" (#423)

### Added — Gemini
- `imagesOffered`, counted per exchange (`.conversation-container`), so an image on the page that the capture neither took nor reported makes a Gemini export incomplete, as on ChatGPT and Claude (#424)

## [1.9.5] — 2026-10-18

### Fixed
- A conversation that fits on screen exports complete. With nothing to scroll, `findScrollContainer()` falls back to `<body>`, and every message was refused an ordering key because `<body>` does not scroll, so each short ChatGPT or Claude conversation exported `contentComplete: false` with "N of N message(s) could not be positioned". The key is now refused only when something between the scroller and the message scrolls, the case where it could be wrong. Measured live (injected, viewport emulated at 1800px): 4 of 4 messages unpositioned on a ChatGPT and a Claude test conversation; in a 680px window, where the same conversations scroll, 0 of 4. With this release, at 1800px: 4 of 4 positioned, `contentComplete: true`, in the same order as the 680px capture. The rule dates from #264 (2026-09-05), under the 2026-05 markup (#407)

### Changed
- `tools/extension/compare-with-injected.js` prints what each capture said about itself (`contentComplete`, `incompleteReasons`, how the scroll ended) and, for every message only one side holds, its position, role and size and the messages either side, so a turn added between the two captures can be told from a message one of them lost (#308, #405)

## [1.9.4] — 2026-10-17

Claude extraction works again, and ChatGPT images are captured. Measured through the real extension, 1.9.3 exported **none of Claude's replies** from a Claude conversation, and **0 of 2** images from a ChatGPT one, reporting both complete (#409, #331).

### Fixed — Claude
- Claude replies are extracted. Claude's markup changed and nothing carries `.font-claude-response` any more; the reply is `[data-testid="assistant-message"]`, its text read from `[data-transcript-engine-root]` without the screen-reader heading, the status row, the code label or the toolbar (#409)
- Long Claude conversations are captured whole. The transcript now virtualizes (3 to 11 of 18 rows in the page at once, measured live), so Claude moves onto the capture cache, keyed by each message's `data-turn-key`, with the user's whole row as the message so an upload beside the text survives. Measured live: 18 of 18 messages, in order, where the live-DOM read got one window (#409)
- The scroll finds the transcript, not the conversation-list sidebar. `findScrollContainer()` tried its selector list in document order, not in the order written, and the sidebar comes first in the document; the transcript's own `[data-autoscroll-container]` is now tried first, and the list is honoured in order (#409)
- An extraction started away from the bottom of a virtualized conversation no longer loses everything below the starting point: the walk goes down to the newest message first, and `scrollInfo.reachedBottom` says whether it got there. Started from the top, a long Claude conversation had exported 7 of 18 (#413)
- A message whose text contains "Stop" no longer blocks extraction with "Claude is currently generating": Claude puts message text into button labels, and the stop-button test matched any label containing the word (#409)
- Uploaded images on Claude user messages are attached and counted in `imagesOffered` (#409, #410)
- The collapsed status row is no longer exported as the reply's reasoning; capturing the reasoning itself is #316 (#409)

### Fixed — ChatGPT
- A generated-image reply is a message again. It has no text, and 1.9.3 took a reply block for a message only if it held text — a regression #400 introduced. It now also counts a block holding a conversation image, and uses the reply's real message id where the page provides one (#411)
- An uploaded image beside a user message's text is attached to that message; only the text element was searched before (#411)
- `blob:` images are read while they are on screen. Images were fetched after the scroll, from cached copies, by which time the page could have released the URL; a failure that happens anyway now says so instead of "Failed to fetch" (#411)
- A reply with no text block exports empty text, not its screen-reader heading and button captions (#411)

### Added
- `imagesOffered`: the conversation images the page rendered, counted from each exchange rather than through the message selectors. An image neither in the ZIP nor in `mediaErrors` is named in `incompleteReasons` and makes the capture incomplete — an export with images missing can no longer report clean (#410). ChatGPT and Claude; Gemini gets its own with its fix
- `tools/extension/` — capture through the real, loaded extension (popup click to ZIP), inspect what a ZIP actually holds, compare a real capture with an injected one by message id, and generate synthetic test images. The first live coverage of the extension itself since Chrome stopped honouring `--load-extension` (#406, toward #308)

## [1.9.3] — 2026-10-17

### Fixed
- On ChatGPT, the check that reports reasoning the page offered but the capture did not take (#324) works on the 2026-10 markup again. The "Worked for 5m 34s" line sits in a block beside the reply, and its expand button carries no text or label, so the old count was zero on every conversation. It now counts per reply, from what rendered during the scroll rather than only what is on screen at the end (#400)
- A reply's marker block counts as a message only when it holds reply text. A block holding only a reasoning line is no longer taken for a reply and then discarded, and a block that does hold text is always kept, even beside a unit, so no reply text can be dropped (#400)

### Changed
- **ChatGPT conversations that show reasoning now export with `contentComplete: false`** and an `incompleteReasons` entry naming how many replies' reasoning was not captured. That is the truthful answer while reasoning capture is unbuilt (#316). It was the answer 1.9.2 should have given and did not
- `orderInfo.replyBlocksSupersededByUnit` is removed; the mechanism it counted no longer exists (#400)

### Added
- `tools/chatgpt/README.md` describes running the live probes from Ubuntu (WSL) as well as Windows, and why the two sides cannot be mixed (#403)

## [1.9.2] — 2026-10-17

ChatGPT replaced its conversation markup, and every ChatGPT extraction in 1.9.1 failed before it began with "ChatGPT UI may have changed. Missing selectors: messages." This release reads the new markup and keeps reading the old (#399).

### Fixed
- ChatGPT messages are found again: the message element, its role and its id are read from the new search-unit markup, beside the 2026-05 attributes (#399)
- The thread's new scroll container is used, so scroll-back reaches the start of a long conversation (#399)
- Code blocks in the new markup are fenced with their header's language, and the header label and the copy/wrap captions no longer land in the text (#399)
- A message first seen before its content rendered is re-captured once the content arrives: an assistant reply before its text, an image-only user message before its image. Without this, 24 of 75 replies in one measured capture were dropped as blank in an export that reported `contentComplete: true`. `orderInfo.refreshedAfterLateRender` counts them (#399)
- Agent-style replies, which ChatGPT renders with no message unit and no id (tool activity interleaved with text), are captured, every text block in order, without the activity lines. One measured conversation had 12 of them, all previously missing (#399)
- Reply blocks are `display: contents` and have no box of their own; they are now positioned by their first laid-out child, so they sort into place rather than being appended at the end (#399)
- A reply's marker block that holds only a reasoning line is replaced in the capture cache by its exchange's unit, so no reply is exported twice. `orderInfo.replyBlocksSupersededByUnit` counts them (#399). *Corrected 2026-10-17: this entry first said such a block had been "caught before its unit mounted". It had not; the unit is in the next block of the exchange by design, which 1.9.3 handles directly (#400).*

### Added
- `tools/chatgpt/probe-turns.js` — structural census of the live thread markup, the probe that found the new shape (#399)
- `tools/chatgpt/verify-extract.js` — runs the real `extractConversation()` on the live page and reports what it produced, including every message dropped as blank (#399)

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
