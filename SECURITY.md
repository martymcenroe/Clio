# Security Policy

Clio is a Chrome extension that extracts your Gemini, Claude, and ChatGPT conversations to local JSON. It runs entirely in your browser. Security is a design constraint, not a feature added later.

## Reporting a vulnerability

If you believe you have found a security vulnerability in Clio, please report it privately to:

**opensource@martymcenroe.ai** (subject line: `Clio security report`)

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

## Threat model in CIA terms

Clio's security commitments map cleanly to the classic CIA triad:

| Pillar | What it means for Clio | Detailed discussion |
|--------|------------------------|---------------------|
| **C — Confidentiality** | Conversation content does not leave the user's browser | [Privacy Architecture wiki page](https://github.com/martymcenroe/Clio/wiki/Privacy-Architecture) |
| **I — Integrity** | The extracted archive faithfully reflects what the user saw, or fails loudly | [Provenance and Auditability wiki page](https://github.com/martymcenroe/Clio/wiki/Provenance-and-Auditability) |
| **A — Availability** | The user retains access to their conversations even when the provider denies it | [Availability and Denial of Access wiki page](https://github.com/martymcenroe/Clio/wiki/Availability-and-Denial-of-Access) |

Confidentiality and Integrity follow the conventional attacker-defender frame. Availability is structurally different in this domain — the actor most likely to deny the user access is the *legitimate custodian* (the LLM provider) acting on its own policy, and the defense is *user-side retention*, not *attacker-side prevention*.

## What Clio defends against by design

Clio's defense posture comes primarily from constraints in the manifest and the code paths the manifest allows. The following are enforced architecturally, not by runtime checks alone.

### Confidentiality and Integrity defenses

#### 1. No remote transmission of conversation content *(C)*

The extension declares **no** host permissions outside the three LLM domains it operates on (`gemini.google.com`, `claude.ai`, `chatgpt.com`). It has no `fetch` calls to any other origin. Saved JSON and images leave the browser only via Chrome's `downloads` API — i.e., to the user's local disk, by the user's confirmation.

#### 2. Minimal permission surface *(C, I)*

The manifest requests only:

| Permission | Why it exists | Alternative considered |
|-----------|---------------|------------------------|
| `activeTab` | Read the DOM of the conversation you are looking at when you press the toolbar button | `tabs` (broader; rejected) |
| `downloads` | Write the extracted ZIP to disk via the user's "Save As" dialog | Direct file write (rejected; Chrome does not support) |
| `host_permissions` for 3 specific origins | Inject the content script that walks the DOM on those exact sites | `<all_urls>` (rejected — too broad for the actual need) |

No `tabs`, no `cookies`, no `webRequest`, no `scripting` outside the declared content scripts, no `storage` (current versions), no `identity`.

#### 3. Content-script world isolation *(I)*

Clio's content scripts run in Chrome's isolated world. They share the page's DOM but not its JavaScript heap. This means:

- A malicious or compromised LLM page cannot read Clio's variables or modify Clio's call stack from page JavaScript.
- Clio cannot accidentally expose extension-only state through `window` (because Chrome enforces the separation).

This is a standard Manifest V3 protection — Clio relies on it rather than reimplementing it.

#### 4. No remote code loading *(C, I)*

Clio loads no scripts from any remote source. JSZip is bundled locally; there is no CDN dependency at runtime. This is consistent with Manifest V3's prohibition on remotely-hosted code.

#### 5. Fail-closed for text, fail-open for images *(I, A)*

If Clio cannot find any messages, extraction fails loudly rather than producing a silent partial capture that would corrupt the user's archive. Image fetch errors are logged in the JSON metadata but do not stop the run — text is the primary artifact and a missing image should not lose a conversation. This decision is documented in the design principles in [CONTRIBUTING.md](CONTRIBUTING.md).

Fail-closed-for-text is an *integrity* decision (silent partial captures corrupt the record) and an *availability* decision (a partial archive the user later relies on is worse than no archive at all).

### Availability defenses

The conventional "attacker against defender" frame does not fit availability for this product. The denial-of-access actor most relevant to Clio's users is the *LLM provider itself*, acting on policy:

| Denial vector | Example |
|---------------|---------|
| Account suspension or deletion | TOS flag, inactivity, billing dispute |
| Terms-of-service change | "We no longer retain past conversations beyond N days" |
| Single-conversation removal | Post-hoc moderation, content-policy update |
| Regional restriction | Service withdrawn from a country |
| Subscription downgrade | Cancel paid plan → lose historical access |
| Provider data loss | Infrastructure incident, backup failure |
| Provider shutdown | Bankruptcy, acquisition, product sunset |
| Network unavailability | User offline, captive portal, ISP outage |

None of these is an *attack* in the conventional sense. All result in the user losing access to data they had relied on. Clio's defense for every vector in the table is the user's local archive — a conversation extracted to local JSON is immune to all of them.

Shifting custody from the provider to the user does not eliminate availability risk; it moves it. See **Out of scope** below for the user-side availability concerns that remain the user's responsibility.

Full discussion: [Availability and Denial of Access](https://github.com/martymcenroe/Clio/wiki/Availability-and-Denial-of-Access).

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

### Confidentiality / Integrity, out of scope

- **A compromised host browser.** If Chrome itself is owned, the extension is owned.
- **A malicious LLM site.** Clio reads the DOM you are already viewing. If that DOM is hostile (e.g. injected HTML that mimics a conversation), Clio will extract whatever is rendered. Clio is not a sandbox for the conversation content itself; it is an archiver.
- **Side-channel attacks against the conversation provider.** Clio does not authenticate, does not impersonate, and does not bypass any rate limiting. It captures what the logged-in user is already seeing.
- **Network observers.** Clio is not a privacy tool against your ISP, the LLM provider, or your network — it operates *after* the conversation has occurred and been rendered.

### Availability, out of scope

User-side custody concerns Clio cannot protect against:

- **Local disk loss or corruption.** Failed drive, file-system damage.
- **Hardware loss or theft.** Laptop stolen, phone lost.
- **Encryption with a forgotten key.** BitLocker, FileVault, dm-crypt.
- **Accidental deletion.** `rm`, emptying the Trash, ZIP file overwritten.
- **Ransomware on the user's machine.** Local-side denial-of-access at machine speed.
- **Loss of provider access *prior* to extraction.** Clio cannot retroactively archive what the user can no longer view; the user must extract while access still exists.

Standard local-data hygiene applies — backups, multi-device sync, version control of the archive directory. The user is the custodian.

## Security design principles

These principles guide changes to the codebase. They are also documented in [CONTRIBUTING.md](CONTRIBUTING.md):

1. **Local processing only.** Conversation content does not leave the browser. *(C)*
2. **Minimal manifest surface.** New permissions require explicit justification in the PR description. *(C, I)*
3. **No remote code loading.** All dependencies are vendored at build time. *(C, I)*
4. **Fail closed where silent failure would corrupt the user's archive.** Fail open where a partial result is still useful (images). *(I, A)*
5. **Format stability across versions.** The extracted JSON schema should evolve compatibly so older archives remain readable. *(A)*
6. **Honest about boundaries.** If we don't defend against a threat class, this document says so.

## Related research

The design choices above are consistent with the broader research direction on agent-context permission architectures (see `sentinel-rfc` in the author's portfolio): a deployed extension that wants to remain trustworthy must derive its trust from *architectural constraints on what it can do* rather than *runtime promises about what it will not do*. Promises become irrelevant where capabilities never existed. The wiki page [Connection to sentinel-rfc](https://github.com/martymcenroe/Clio/wiki/Connection-to-sentinel-rfc) develops this.

## See also

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — design principles, dev setup, PR conventions
- [`PRIVACY.md`](PRIVACY.md) — what data is processed and where it goes (the C pillar in user-facing form)
- [`extensions/manifest.json`](extensions/manifest.json) — the ground-truth permission declaration
- [Clio Wiki](https://github.com/martymcenroe/Clio/wiki) — full CIA discussion, threat model, and design rationale
