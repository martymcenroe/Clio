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

If you are in the EU, UK, or other jurisdictions covered by GDPR-equivalent laws, you have the right to access, correct, delete, restrict, or object to processing of your personal data, and the right to data portability.

Clio holds no personal data. Your conversations and the ZIP files Clio writes live only on your own device, never on any Clio-controlled server. Those rights are therefore fulfilled by default — you control the files via your operating system, and there is nothing on a Clio server to access, export, or delete.

If you still wish to make a formal data subject request (for example, to confirm we hold no data about you), email **opensource@martymcenroe.ai** with subject `Clio GDPR request`. We will respond within 30 days.

We are not a "data controller" or "data processor" in the GDPR sense for any personal data, because the extension's architecture makes such processing impossible.

## Children's privacy

Clio does not knowingly collect any data from anyone, including children. If you believe a child has been harmed by Clio's behavior, please contact us at the email below — but note that Clio runs locally and does not store or transmit data.

## Changes to this policy

If this policy changes materially, the change will be reflected in a new "Last updated" date and announced in the project's [CHANGELOG.md](CHANGELOG.md).

## Contact

Privacy questions: **opensource@martymcenroe.ai** (subject: `Clio privacy question`)

Security vulnerabilities should be reported per [SECURITY.md](SECURITY.md), not as privacy questions.
