# Chrome Web Store Listing Copy — Clio

This file is the canonical source for everything that gets pasted into the
Chrome Web Store submission form. Each section maps to one CWS field.
Edit here, then copy-paste at submission time so the listing matches what
the repo says.

---

## Name

```
Clio
```

---

## Short description

*CWS limit: 132 characters. Current draft: 105 chars.*

```
Export Claude, Gemini, and ChatGPT conversations to JSON + images. One click, fully local, no telemetry.
```

---

## Long description

*CWS limit: 16,000 characters. Plain text, no HTML.*

```
Clio is a Chrome extension that exports your conversations with Claude, Gemini, and ChatGPT to structured JSON files — for archival, research, citation, or personal record-keeping.

HOW IT WORKS

1. Open any conversation on claude.ai, gemini.google.com, or chatgpt.com
2. Click the Clio icon in your toolbar
3. The conversation downloads as a ZIP containing structured JSON (every turn, role, model identifier where available) plus all the images you've sent or received in that conversation

PRIVACY-FIRST BY DESIGN

Clio processes everything locally in your browser. Your conversations are NEVER sent to a server, never uploaded, never analyzed by any third party, never used to train any model. There is no Clio account, no signup, no telemetry. The extension makes no network requests outside of fetching images already embedded in your conversation (from the LLM provider's own image hosts).

WHAT GETS EXTRACTED

- Every user message and assistant response, in order
- Each turn's text content (preserving code blocks with language tags)
- Embedded images (saved alongside the JSON in the ZIP)
- Conversation title and ID
- Model identifier where the site exposes it (e.g. gpt-4o, claude-opus-4-7, gemini-2.5-pro)
- Thinking / reasoning content where applicable (Claude extended thinking, ChatGPT o-series reasoning labels)

USE CASES

- Personal archive of your LLM conversations across providers
- Backup before clearing your conversation history
- Feeding old conversations into your own tooling (RAG, search, fine-tuning datasets you control)
- Citing specific exchanges in writing or research
- Comparing how different models handled the same question

SUPPORTED SITES

- claude.ai — Anthropic Claude
- gemini.google.com — Google Gemini
- chatgpt.com — OpenAI ChatGPT

WHAT CLIO IS NOT

- Not a cloud backup service. Your conversations stay on your machine.
- Not an automatic backup. You click the icon when you want to export.
- Not a cross-conversation search tool (planned for a future version).
- Not affiliated with Anthropic, Google, or OpenAI.

OPEN SOURCE

MIT licensed. Source code, issue tracker, and changelog at
https://github.com/martymcenroe/Clio. Privacy policy at
https://cliocast.com/privacy.
```

---

## Category

```
Productivity
```

---

## Language

```
English (United States)
```

---

## Permission justifications

CWS requires a brief written justification for each declared permission and
host permission. Paste these into the matching fields at submission time.

### activeTab

```
Used to read the DOM of the currently active conversation tab when the user clicks the Clio icon. The extension does not access any other tab. activeTab is granted at click time and revoked when the user leaves the tab — Chrome enforces this scoping by design. This permission is the minimum required for the extension's stated function (one-click conversation export).
```

### downloads

```
Used to save the extracted conversation as a ZIP file to the user's computer. The ZIP is created entirely in the browser (via JSZip, bundled in the extension) and saved through Chrome's standard download flow to whatever folder the user has configured. No external upload, no server involvement.
```

### scripting

```
Used solely as a recovery path. When the user clicks Clio on a tab that was opened before Clio was installed or last reloaded, Chrome's content script hasn't been injected into that tab — clicking the extract button would otherwise fail with the raw error "Could not establish connection." The scripting permission lets Clio re-inject its own content script (the same files declared in the manifest's content_scripts entries) into the active tab so the extraction can proceed. It is invoked only on this specific failure path, only into the currently active tab, and only with Clio's own bundled scripts. It is not used to inject code into any other tab or at any other time.
```

### Host permissions: `https://claude.ai/*`, `https://gemini.google.com/*`, `https://chatgpt.com/*`

```
The content script must be allowed to run on these three AI chat sites in order to read the conversation DOM and extract message content. The script does not run on any other site. These three hosts are the entirety of the extension's web-surface — Clio has no business logic, fetches no analytics, and makes no requests outside the user's already-loaded conversation.
```

---

## Privacy policy URL

```
https://cliocast.com/privacy
```

---

## Single-purpose description

*CWS asks: "Describe the single purpose of your extension."*

```
Export the user's own conversations with Claude, Gemini, and ChatGPT to a structured JSON file (plus any embedded images) on a single click, with no server-side component.
```

---

## Support / contact email

```
cto@thrivetech.ai
```

*(Matches what runbook 30002 already documents as the publisher contact.)*

---

## Notes for the submitter (not pasted to CWS)

- Screenshots: see `docs/assets/store/` — must have at least one at 1280x800 PNG. Recommend one screenshot per supported site (3 total) for the listing carousel.
- Promo tile (440x280 PNG): optional. Skip unless we want to be eligible for featured-listing slots.
- If the CWS review team asks for clarification on the privacy claims, the relevant evidence is: (a) zero `fetch()` / `XMLHttpRequest` calls in `extensions/src/` outside of `findImages` (which fetches images embedded in the conversation), (b) no analytics SDKs in `package.json`, (c) `host_permissions` scoped to the three target sites only.
