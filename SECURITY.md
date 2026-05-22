# Security Policy

Clio is a Chrome extension that extracts your Gemini, Claude, and ChatGPT conversations to local JSON. It runs entirely in your browser. Security is a design constraint, not a feature added later.

## Reporting a vulnerability

If you believe you have found a security vulnerability in Clio, please report it privately to:

**martymcenroe@gmail.com** (subject line: `Clio security report`)

Please **do not** file a public GitHub issue for security reports. The `Report a vulnerability` link routed from the issue templates points here.

When you report, please include:

- A description of the issue and where you observed it
- A minimal reproduction (URL, manifest version, browser, OS)
- Any proof-of-concept code or screenshots
- Your name / handle if you'd like attribution in the fix

You will get an acknowledgment within 7 days on a best-effort basis. Clio is a personal-time project — there is no staffed security on-call and no bug bounty.

## Supported versions

Only the latest published Chrome Web Store version is supported. Chrome Web Store auto-updates installed extensions, so users running an outdated build are an artifact of side-loaded developer-mode installs.

| Version | Supported |
|---------|-----------|
| Latest CWS release | ✓ |
| Side-loaded older versions | Please update via `chrome://extensions` |
| Versions tagged `pre-1.0.0` | Not supported |

## Threat model — what Clio defends against by design

Clio's defense posture comes primarily from constraints in the manifest and the code paths the manifest allows. The following are enforced architecturally, not by runtime checks alone:

### 1. No remote transmission of conversation content

The extension declares **no** host permissions outside the three LLM domains it operates on (`gemini.google.com`, `claude.ai`, `chatgpt.com`). It has no `fetch` calls to any other origin. Saved JSON and images leave the browser only via Chrome's `downloads` API — i.e., to the user's local disk, by the user's confirmation.

### 2. Minimal permission surface

The manifest requests only:

| Permission | Why it exists | Alternative considered |
|-----------|---------------|------------------------|
| `activeTab` | Read the DOM of the conversation you are looking at when you press the toolbar button | `tabs` (broader; rejected) |
| `downloads` | Write the extracted ZIP to disk via the user's "Save As" dialog | Direct file write (rejected; Chrome does not support) |
| `host_permissions` for 3 specific origins | Inject the content script that walks the DOM on those exact sites | `<all_urls>` (rejected — too broad for the actual need) |

No `tabs`, no `cookies`, no `webRequest`, no `scripting` outside the declared content scripts, no `storage` (current versions), no `identity`.

### 3. Content-script world isolation

Clio's content scripts run in Chrome's isolated world. They share the page's DOM but not its JavaScript heap. This means:

- A malicious or compromised LLM page cannot read Clio's variables or modify Clio's call stack from page JavaScript.
- Clio cannot accidentally expose extension-only state through `window` (because Chrome enforces the separation).

This is a standard Manifest V3 protection — Clio relies on it rather than reimplementing it.

### 4. No remote code loading

Clio loads no scripts from any remote source. JSZip is bundled locally; there is no CDN dependency at runtime. This is consistent with Manifest V3's prohibition on remotely-hosted code.

### 5. Fail-closed for text, fail-open for images

If Clio cannot find any messages, extraction fails loudly rather than producing a silent partial capture that would corrupt the user's archive. Image fetch errors are logged in the JSON metadata but do not stop the run — text is the primary artifact and a missing image should not lose a conversation. This decision is documented in the design principles in [CONTRIBUTING.md](CONTRIBUTING.md).

## Defense in depth — why the manifest is the way it is

The fastest way to inspect Clio's security posture is to read `extensions/manifest.json`. Every entry is load-bearing:

- `manifest_version: 3` — opts into Chrome's tightened security model (no inline scripts, no `eval`, no remote scripts).
- `permissions: ["activeTab", "downloads"]` — see table above.
- `host_permissions:` exactly three origins — see table above.
- `content_scripts:` three entries, each matching one of those origins and running at `document_idle` (after the page loads its own scripts, before the user is likely to act).
- `background.service_worker` — minimal coordination logic; does not hold conversation content.

If a future change proposes adding a permission, the PR must justify it explicitly. See [CONTRIBUTING.md](CONTRIBUTING.md) under "Design principles."

## Out of scope

Clio does **not** defend against, and does not claim to defend against:

- **A compromised host browser.** If Chrome itself is owned, the extension is owned.
- **A malicious LLM site.** Clio reads the DOM you are already viewing. If that DOM is hostile (e.g. injected HTML that mimics a conversation), Clio will extract whatever is rendered. Clio is not a sandbox for the conversation content itself; it is an archiver.
- **Side-channel attacks against the conversation provider.** Clio does not authenticate, does not impersonate, and does not bypass any rate limiting. It captures what the logged-in user is already seeing.
- **Network observers.** Clio is not a privacy tool against your ISP, the LLM provider, or your network — it operates *after* the conversation has occurred and been rendered.

## Security design principles

These principles guide changes to the codebase. They are also documented in [CONTRIBUTING.md](CONTRIBUTING.md):

1. **Local processing only.** Conversation content does not leave the browser.
2. **Minimal manifest surface.** New permissions require explicit justification in the PR description.
3. **No remote code loading.** All dependencies are vendored at build time.
4. **Fail closed where silent failure would corrupt the user's archive.** Fail open where a partial result is still useful (images).
5. **Honest about boundaries.** If we don't defend against a threat class, this document says so.

## Related research

The design choices above are consistent with the broader research direction on agent-context permission architectures (see `sentinel-rfc` in the author's portfolio): a deployed extension that wants to remain trustworthy must derive its trust from architectural constraints (manifest, permissions, code paths) rather than from runtime policy alone.

## See also

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — design principles, dev setup, PR conventions
- [`PRIVACY.md`](PRIVACY.md) — what data is processed and where it goes (separately maintained from this security policy)
- [`extensions/manifest.json`](extensions/manifest.json) — the ground-truth permission declaration
