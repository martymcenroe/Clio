# Chrome Web Store Release Notes — v1.4.1

> **Version:** 1.4.1
> **Previous version:** 1.4.0 (tagged 2026-05-24; never submitted — superseded by 1.4.1)
> **Tag commit:** `8fdea16`
> **Submission date:** TBD — fill at upload time (see GitHub issue #95)

## Public-facing notes (Chrome Web Store "What's New")

Initial public release.

Clio extracts your conversations with Claude, Gemini, and ChatGPT to a structured JSON file (plus all embedded images) on a single click — fully local, no server, no telemetry, no signup.

Supported sites:

- claude.ai — Anthropic Claude (including extended thinking, where exposed)
- gemini.google.com — Google Gemini (including user-uploaded images)
- chatgpt.com — OpenAI ChatGPT (including o-series reasoning labels)

The extracted ZIP contains:

- `conversation.json` — every turn, role, model identifier where available, thinking content where exposed
- `images/` — all embedded images from the conversation

## Reviewer notes

Clio is a strict-local conversation-export utility. Every operation happens in the user's browser; no network calls outside fetching images already embedded in the conversation being exported.

### Smoke-test path

1. Install Clio from the listing
2. Open any conversation on `https://gemini.google.com`, `https://claude.ai`, or `https://chatgpt.com`
3. Click the Clio icon in the Chrome toolbar
4. Click **Extract** in the popup
5. A ZIP file downloads to the user's configured Downloads folder
6. No further network activity occurs

### Strict-local evidence the reviewer can verify in source

- Zero `fetch()` / `XMLHttpRequest` calls in `extensions/src/` outside of fetching images from the declared image hosts during extraction
- No analytics SDKs in `package.json`
- Background service worker (`extensions/src/background.js`) reduced to no-op listener stubs as of v1.4.1 — no executable body
- Source available at https://github.com/martymcenroe/Clio under MIT license

### Permission-justification summary

Full text in runbook §9 / inlined into the CWS form fields:

- `activeTab` — read the active tab's DOM on toolbar click only
- `downloads` — write the ZIP to the user's local downloads folder via Chrome's standard save flow
- `scripting` — recovery-only re-injection of Clio's own bundled content scripts when the tab pre-dates the extension install
- `host_permissions: gemini.google.com / claude.ai / chatgpt.com` — the three target sites for the content script
- `host_permissions: *.googleusercontent.com` — image fetching for user-uploaded Gemini images

### What changed since the never-submitted v1.4.0

Two `console.log` breadcrumbs were stripped from the background service worker (PR #152). They did not violate the privacy policy (local console output, never transmitted off-device), but presented an unnecessary surface for a reviewer auditing a strict-local extension. v1.4.1 ships without them. Listener bodies are now no-op stubs; the registrations remain because the manifest declares them.

See `CHANGELOG.md` `[1.4.1] — 2026-05-25` for the per-commit Removed / Changed breakdown.
