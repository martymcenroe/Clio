# Privacy Policy

**Last updated:** 2026-05-23

## Summary

Clio is a Chrome extension that extracts your Gemini, Claude, and ChatGPT conversations to local JSON files. **All processing happens in your browser.** Clio does not transmit your conversations to any external server, does not send telemetry, and does not collect personally identifiable information.

This policy describes precisely what Clio does and does not do with data.

## What Clio processes

When you press the toolbar button on a supported LLM site, Clio reads the **conversation DOM** of the page you are currently viewing. That includes:

- The text of your messages and the assistant's replies
- Code blocks, with language labels preserved
- Images embedded in the conversation (when present)
- Assistant "thinking" / reasoning sections, when expanded
- The conversation title, conversation ID, and URL

These pieces are assembled into a ZIP archive containing:

- `conversation.json` — the structured transcript
- `images/` — extracted image files

## Where this data goes

The ZIP file is written to your local disk via Chrome's `chrome.downloads` API. The "Save As" dialog from Chrome lets you pick the destination. **That is the only place the data goes.**

Clio does not:

- Transmit conversation content to any external server
- Send telemetry, error reports, or usage analytics
- Maintain a remote database
- Share data with third parties
- Track you across sites
- Embed any analytics, advertising, or fingerprinting library
- Load any code from a remote source (everything is bundled in the extension)

You can verify this by reading the [extension manifest](extensions/manifest.json) and the source code — there are no `fetch` or `XMLHttpRequest` calls to any origin outside `gemini.google.com`, `claude.ai`, and `chatgpt.com`, and those exist only to read the DOM rendered for you in your own session.

## Permission rationale

The Chrome Web Store requires extensions to justify every permission they request. Clio's manifest is intentionally minimal:

| Permission | What it allows | Why Clio needs it |
|-----------|----------------|-------------------|
| `activeTab` | Read the DOM of the tab you are currently looking at, only when you press the toolbar button | Required to read the conversation you want to extract |
| `downloads` | Write the result ZIP via the "Save As" dialog | Required to save the extraction to your disk |
| `host_permissions` for `gemini.google.com`, `claude.ai`, `chatgpt.com` | Inject Clio's DOM-walking content script on those exact sites | The three sites Clio supports — nowhere else |

Permissions Clio does **not** request: `tabs`, `cookies`, `webRequest`, `storage`, `identity`, `notifications`, broader `host_permissions`.

## Open-source transparency

Clio's full source code is available at [github.com/martymcenroe/Clio](https://github.com/martymcenroe/Clio). The extension is licensed under [MIT](LICENSE). You can build the same extension from source and verify byte-for-byte what is running.

The security posture is documented in detail in [SECURITY.md](SECURITY.md), including the threat model and explicit out-of-scope items.

## Your control over your data

Because all data lives only on your local disk, your data subject rights are exercised by you directly through your operating system: delete the ZIP files when you no longer want them. Clio has no remote copy of anything to delete on your behalf.

The conversations themselves remain on the LLM provider's servers under their own privacy terms — Clio does not change anything about Google's, Anthropic's, or OpenAI's data handling. Clio gives you a local copy; it does not remove the original.

## GDPR / UK GDPR

Clio does not process personal data. Your conversations and the ZIP files Clio creates live only on your device. There is no Clio server, no Clio database, no record on our side that holds anything about you.

If you are in the EU, UK, or somewhere covered by similar law, your subject rights (access, deletion, portability, and so on) are met by default. There is nothing on our end to access or delete. You control your local files yourself, through your operating system.

The author of Clio is the software's publisher, not a data controller or processor in the GDPR sense. The way the extension is built, data collection on our side is not possible.

## Children's privacy

Clio does not collect data from anyone, including children. COPPA, GDPR-K, and similar laws are about collection of personal information from children. Since Clio is local-only and the extension never sends data anywhere, no such collection happens. There is no remote endpoint, no telemetry, and no advertising.

## Changes to this policy

If this policy changes materially, the change will be reflected in a new "Last updated" date and announced in the project's [CHANGELOG.md](CHANGELOG.md).

## Contact

Privacy questions: **opensource@martymcenroe.ai** (subject: `Clio privacy question`)

Security vulnerabilities should be reported per [SECURITY.md](SECURITY.md), not as privacy questions.
