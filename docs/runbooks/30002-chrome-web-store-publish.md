# 30002 — Chrome Web Store Publishing (Clio)

> **Version:** 7
> **Last updated:** 2026-05-28 3:40:27 PM Central
> **Applies to:** Clio Chrome extension, every submission to the Chrome Web Store
> **Tracking issue:** [martymcenroe/Clio#95](https://github.com/martymcenroe/Clio/issues/95)
> **Account-setup material:** moved to [`30004-cws-account-setup.md`](./30004-cws-account-setup.md)

## Throughout this runbook

- **Operator** — the human running the publishing process at the Chrome Web Store dashboard. Can perform any step.
- **Agent** — a Claude Code session with this repo's working tree available. Performs any step marked agent. Invoked by the canonical phrases in §0 below.

## How to verify you have the latest copy

This runbook lives at `docs/runbooks/30002-chrome-web-store-publish.md` in [martymcenroe/Clio](https://github.com/martymcenroe/Clio). The **Version** and **Last updated** lines above identify which revision you're holding.

To compare a printed copy against the canonical:

1. Note the version number on your copy
2. Say `Run pre-flight` or `Audit 30002` (see §0) — the agent reports the current `main` HEAD's runbook version line as part of its output
3. If your copy's version differs, re-print before continuing

The §17 Change log at the bottom of this file lists every version with what changed.

## 0. Invoke the agent (canonical phrases)

The operator types one of these phrases into the agent chat to trigger the matching action. The agent should recognize the phrase verbatim or with minor punctuation variation; if a phrase below is ambiguous in context, the agent asks for clarification before acting.

| To make the agent... | Operator says |
|---|---|
| Audit the runbook itself for gaps / drift | `Audit 30002` |
| Run §3a pre-flight + §4 build in one go and hand back the ZIP path | `Run pre-flight` |
| Run §3a only (no build) and report findings | `Run §3a` |
| Run §4 build + verify (pre-flight already passed) | `Run §4` |
| Comment submission date on #95 (uses current Central time, or pass `at YYYY-MM-DD HH:MM`) | `Submitted` |
| After CWS approves: run §12a — README + `docs/index.html` install-link update PR, tag the commit, comment + close #95 | `Run post-publish <live CWS URL>` |

The agent's reply to any of these includes: (a) a one-line confirmation of what it just did, (b) any findings or follow-ups, (c) the current `main` HEAD's runbook version line so the operator can sanity-check their printed copy on every turn.

## 1. Where to start (reading paths)

Pick the path that matches your situation; sections you don't need can be skipped on this submission.

| Situation | Read sections |
|-----------|--------------|
| **Path A — First Clio submission** (CWS Items list does not show Clio yet) | §2 → §3 → §4 → §5 → §7 → §8 → §9 → §10 → §11 → §12 |
| **Path B — Subsequent Clio update** (CWS Items list shows Clio) | §2 → §3 → §4 → §6 → §11 → §12 |
| **Path C — New machine, new Chrome profile, or new publisher account** | Stop. Read [`30004-cws-account-setup.md`](./30004-cws-account-setup.md) first, then return here as Path A or Path B |

§13 Version bump procedure, §14 Troubleshooting, §15 Release notes, §16 Related documents, §17 Change log are reference material — skim once, then return as needed.

## 2. Account check (every submission)

Whether this is the first submission or the hundredth, verify the correct identity before any upload:

1. Open `https://chrome.google.com/webstore/devconsole`
2. The top-right **Publisher** chip must read `ThriveTech.ai`
3. Click the avatar (top-right) to confirm the active account email is `cto@thrivetech.ai`
4. If it's any other Google identity: sign out fully (`https://accounts.google.com/Logout`), close all Chrome windows, re-open, navigate to the dashboard again, choose `cto@thrivetech.ai` from the picker

Full account-setup detail (registration, multi-account hazard explanation, first-time verification) lives in [`30004-cws-account-setup.md`](./30004-cws-account-setup.md). This §2 is just the in-line check; if it fails, that runbook is the diagnostic path.

## 3. Pre-flight checklist

Split by responsibility. **Agent items** happen in the repo. **Operator items** happen on the publishing machine and dashboard. Each party checks their own before handing off. Items are numbered so they can be referenced as "§3a.N" or "§3b.N".

### 3a. Agent does (in the repo, before producing the ZIP)

1. `extensions/manifest.json` has the new `version` value, monotonically increasing from the last published version. For Path A first submission, no prior published version exists; auto-pass.
2. `host_permissions` matches `extensions/manifest.json`'s `host_permissions` array. Each entry has a paste-block justification in §9. Adding a new host to the manifest requires also adding a §9 paste-block; if §9 has fewer entries than the manifest, that's the finding.
3. `permissions` is exactly `activeTab`, `downloads`, `scripting`
4. No live debug-tier console calls in `extensions/src/*.js`. **Banned:** live `console.log` / `console.debug` / `console.info` / `console.warn`. **Allowed:** `console.error` inside a `try/catch` that also surfaces the error to the user via the popup UI (e.g. `popup.js`'s extraction-error handler); commented-out calls; explanatory comments mentioning these by name.
5. No hardcoded test URLs, dev flags, or scratch code
6. All tests pass: `npm test`
7. Lint clean: `npm run lint`. **Aspirational** — if `package.json` has no `lint` script, file (or reference) a tracking issue for eslint setup and continue. Do not block ship. (Current tracker: #165.)
8. Version bump merged to `main` — build from `main`, never a feature branch
9. `CHANGELOG.md` has a dated entry for this version (not `[Unreleased]`)
10. Release notes file `docs/releases/chrome-vX.Y.Z.md` written before the §4 build — see §15
11. Listing screenshots exist at `docs/assets/store/screenshot-*.png`, format PNG, dimensions 1280×800. Mechanical check; agent reports file list, sizes, and dimensions to the operator.
12. Agent reads each `docs/assets/store/screenshot-*.png` and pre-describes what's visible (browser chrome, popup state, conversation content). Operator confirms in §3b.3 — agent's pre-description reduces operator's review from "from scratch" to "approve flag-list."
13. Agent reports the current `main` HEAD commit SHA and the runbook's `> **Version:**` line so the operator can sanity-check their printed copy against ground truth.

### 3b. Operator does (on the publishing machine)

1. §2 Account check passes — Publisher chip reads `ThriveTech.ai` and avatar email is `cto@thrivetech.ai`
2. The version isn't already in the dashboard. For Path B updates, check the Package tab's version history. For Path A first submissions, Clio doesn't exist in the Items list yet; auto-pass.
3. Operator approves agent's §3a.12 screenshot pre-description, or flags personal info / embarrassing content the agent missed
4. §7 / §8 / §9 paste-blocks in this runbook reviewed (or intentionally skipped) for changes since last submission — these are the canonical source; no second document to open
5. Operator's printed copy version line matches the version the agent reported in §3a.13

If any §3a item is unchecked, the agent fixes what it can (write missing release notes, file lint tracker, etc.) and surfaces the rest to the operator before producing the ZIP. If any §3b item is unchecked, the operator pauses before clicking Upload.

## 4. Build & verify the ZIP (agent does this)

**Agent runs §4a + §4b. Operator receives the ZIP path and uploads it at §5 (Path A) or §6 (Path B).**

**CRITICAL:** Use `zip` from MSYS2 / Git Bash. Never PowerShell `Compress-Archive` — it writes backslash separators, which the CWS reviewer flags as malformed.

**CRITICAL:** `extensions/` must contain only extension files. No `docs/`, `tests/`, `tools/`, `node_modules/`, or other content. Verify before zipping.

### 4a. Build (agent does this)

```bash
cd /c/Users/mcwiz/Projects/Clio
python tools/build_release.py  # produces dist/clio-chrome-vX.Y.Z.zip
```

`build_release.py` removes any stale `dist/clio-chrome-v*.zip` files from prior versions before producing the new one, so the operator cannot accidentally upload an old artifact from the dashboard's file picker.

Fallback if `tools/build_release.py` is missing or broken:

```bash
cd /c/Users/mcwiz/Projects/Clio
rm -f dist/clio-chrome-v*.zip  # clean stale artifacts manually
cd extensions
zip -r ../dist/clio-chrome-vX.Y.Z.zip . -x '.*' -x '*/.*' -x 'node_modules/*'
```

### 4b. Verify (agent does this)

```bash
cd /c/Users/mcwiz/Projects/Clio
unzip -l dist/clio-chrome-vX.Y.Z.zip
```

Confirm:

- Forward slashes in all paths (no backslashes)
- `manifest.json` at the archive root
- `src/`, `icons/` present
- Four icons: 16, 32, 48, 128
- No unexpected files (docs, session logs, dotfiles, scratch files)

Sanity-check the manifest version inside the ZIP:

```bash
unzip -p dist/clio-chrome-vX.Y.Z.zip manifest.json | grep '"version"'
```

The reported version must match the ZIP filename.

The agent hands the operator a single line: the path to `dist/clio-chrome-vX.Y.Z.zip`. The operator opens it at the dashboard upload step.

## 5. First submission upload (Path A — Clio not yet in the dashboard)

Use this section only if Clio does **not** appear in the dashboard's Items list. (Confirmation cue: the Items list shows Aletheia but no Clio row.)

1. From the dashboard, click **+ New item** (top-right of the Items list — blue button with plus icon)
2. The "Upload your item" dialog opens. Click **Choose file** and select `dist/clio-chrome-vX.Y.Z.zip`
3. Click **Upload**. Validation runs (10–60 s). Validation errors appear inline — fix them in source, rebuild, re-upload before proceeding
4. On successful validation, CWS creates a draft listing for Clio and routes you to the **Store listing** tab. Continue with §7 Store listing.

## 6. Subsequent update upload (Path B — Clio already in the dashboard)

Use this section only if Clio appears as a row in the Items list.

1. From the dashboard, click the **Clio** row to open its listing
2. Left sidebar → **Package**
3. Click **Upload new package** (top of the Package tab)
4. Choose `dist/clio-chrome-vX.Y.Z.zip` and upload
5. Validation runs. On success, the new version becomes the draft. The previously-published version remains live until this draft is submitted and approved.

## 7. Store listing

Update fields if changed. All text below is paste-ready — copy into the matching CWS form field.

### 7a. Name

```
Clio
```

### 7b. Short Description

*CWS limit: 132 characters. Current copy: 105 chars.*

```
Export Claude, Gemini, and ChatGPT conversations to JSON + images. One click, fully local, no telemetry.
```

### 7c. Long Description

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

IF CLIO HELPS YOU

If Clio is useful to you, please leave a Chrome Web Store review or star the GitHub repo. Help others discover this useful extension. Reviews and stars are the way to put it in front of others.
```

### 7d. Category

CWS organizes categories under uppercase meta-headers (PRODUCTIVITY, LIFESTYLE, etc.). PRODUCTIVITY is the header, not a selectable value. Pick `Tools` from the PRODUCTIVITY group.

```
Tools
```

Rationale (preserved for future maintainers):
- `Tools` (selected) — single-purpose utility; matches Clio's framing
- `Developer Tools` (rejected) — too narrow; Clio also serves archival, citation, research, and personal record-keeping per §7c
- `Workflow & Planning` (rejected) — implies process management; Clio is an export utility, not a planner
- `Communication` (rejected) — Clio doesn't enable communication; it exports completed conversations
- `Education` (rejected) — not a teaching tool

### 7e. Language

```
English (United States)
```

### 7f. Support / contact email

```
cto@thrivetech.ai
```

## 8. Privacy tab

| Field | Value |
|-------|-------|
| Privacy Policy URL | `https://cliocast.com/privacy` |
| Handles user data? | Yes — page content (conversation text and images visible in the active tab) |
| Sold to 3rd parties? | No |
| Used for unrelated purposes? | No |
| Used for creditworthiness or lending? | No |

### 8a. Single-purpose description

*CWS asks: "Describe the single purpose of your extension." Paste:*

```
Export the user's own conversations with Claude, Gemini, and ChatGPT to a structured JSON file (plus any embedded images) on a single click, with no server-side component.
```

### 8b. Data usage disclosures (Chrome's mandatory checklist)

| Data type | Collected? | Notes |
|-----------|-----------|-------|
| Personally identifiable info | No | — |
| Health info | No | — |
| Financial info | No | — |
| Authentication info | No | — |
| Personal communications | **Yes** | Conversation text the user is viewing. Processed locally, never transmitted off-device. |
| Location | No | — |
| Web history | No | — |
| User activity | No | — |
| Website content | **Yes** | DOM of the active tab on the three declared LLM sites only, on user-initiated extraction. Processed locally. |

## 9. Permission justifications

CWS requires a written justification for each declared permission and host permission. Each block below is paste-ready into the matching field.

### 9a. `activeTab`

```
Used to read the DOM of the currently active conversation tab when the user clicks the Clio icon. The extension does not access any other tab. activeTab is granted at click time and revoked when the user leaves the tab — Chrome enforces this scoping by design. This permission is the minimum required for the extension's stated function (one-click conversation export).
```

### 9b. `downloads`

```
Used to save the extracted conversation as a ZIP file to the user's computer. The ZIP is created entirely in the browser (via JSZip, bundled in the extension) and saved through Chrome's standard download flow to whatever folder the user has configured. No external upload, no server involvement.
```

### 9c. `scripting`

```
Used solely as a recovery path. When the user clicks Clio on a tab that was opened before Clio was installed or last reloaded, Chrome's content script hasn't been injected into that tab — clicking the extract button would otherwise fail with the raw error "Could not establish connection." The scripting permission lets Clio re-inject its own content script (the same files declared in the manifest's content_scripts entries) into the active tab so the extraction can proceed. It is invoked only on this specific failure path, only into the currently active tab, and only with Clio's own bundled scripts. It is not used to inject code into any other tab or at any other time.
```

### 9d. Host permissions: `https://claude.ai/*`, `https://gemini.google.com/*`, `https://chatgpt.com/*`

```
The content script must be allowed to run on these three AI chat sites in order to read the conversation DOM and extract message content. The script does not run on any other site. These three hosts are the entirety of the extension's web-surface — Clio has no business logic, fetches no analytics, and makes no requests outside the user's already-loaded conversation.
```

### 9e. Host permissions: `https://*.googleusercontent.com/*`

```
Used to fetch user-uploaded image attachments from Gemini conversations. Gemini stores uploaded files at session-authenticated URLs on googleusercontent.com (e.g., lh3.googleusercontent.com). Without this host permission, the browser blocks the extension from fetching these images, leaving them missing from the ZIP. The extension only fetches images that are already embedded in the conversation the user is viewing — it does not read or modify any other content on these hosts. The wildcard covers the various lh3/lh4/lh5 subdomains Gemini may use depending on hash routing.
```

If a reviewer asks why the justifications are unusually short on any one permission: because the extension genuinely does very little. The minimum-surface-area posture is documented in `SECURITY.md` and the wiki's Defense in Depth page.

## 10. Pricing & distribution

| Field | Value |
|-------|-------|
| License | MIT (see [LICENSE](../../LICENSE)) |
| Visibility | Public |
| Regions | All regions |
| Pricing | Free |

## 11. Submit for review

1. Operator clicks **Submit for review**
2. Chrome review typically takes 1–3 business days
3. Operator says `Submitted` to the agent. Agent runs `gh issue comment 95` with the current Central-time submission timestamp, or with the time the operator specified after `at`.

## 12. Post-publish

After Chrome approves the listing and emails the operator that the version is live, the operator says `Run post-publish <live CWS URL>` to the agent. The two split:

### 12a. Agent does (`Run post-publish <URL>`)

1. Update the README install link from "Coming soon" / dev-mode instructions to a direct CWS install link at the supplied URL — branch, commit, PR, merge
2. Update `docs/index.html` install link (`<p class="install-note">Coming soon to the Chrome Web Store.</p>` at line ~147) to a CWS install button at the supplied URL — branch, commit, PR, merge
3. Tag the released commit: `git tag vX.Y.Z-published && git push origin vX.Y.Z-published`
4. Comment on #95 with the approval date and the live URL; close the issue

### 12b. Operator does (clean-profile smoke test)

1. Install Clio from the CWS listing on a clean Chrome profile (agent cannot drive Chrome's profile manager)
2. **Gemini smoke test:** open a Gemini conversation → click the Clio toolbar icon → click Extract → verify a valid ZIP downloads and the JSON parses
3. **Claude smoke test:** repeat on a Claude conversation
4. **ChatGPT smoke test:** repeat on a ChatGPT conversation
5. Verify `chrome://extensions` shows the version that was uploaded

### 12c. If a smoke test fails

Do **not** delist. File a `launch-blocker` issue, reproduce in dev mode, ship a patch version. A version on the store that mostly works is recoverable; a removed listing has to go through review from scratch.

## 13. Version bump procedure

When preparing a new release:

1. Open a GitHub issue describing the release contents — link to the closed work that's bundled in
2. Update `extensions/manifest.json` → `"version": "X.Y.Z"`
3. Update `CHANGELOG.md` `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD` with the actual contents
4. Commit: `chore: bump extension version to X.Y.Z (Closes #N)`
5. Merge to `main`
6. Then follow §4 Build and §5 or §6 Upload above

## 14. Troubleshooting

| Problem | Diagnosis | Action |
|---------|-----------|--------|
| CWS rejects ZIP with "invalid path" or backslash error | ZIP built with PowerShell | Rebuild with `zip` (MSYS2 / Git Bash) |
| "Version already exists" | Forgot to bump | Update manifest, rebuild |
| Reviewer rejection (permission justification) | Reviewer wants more detail | Read rejection carefully — usually a specific permission needs a more concrete user-benefit framing; do not dilute justification just to satisfy them |
| ZIP contains unexpected files | Stray dev artifacts under `extensions/` | Locate and remove; verify `extensions/` is only extension files before re-zipping |
| Privacy Policy URL "not reachable" | Domain or page down | Verify `https://cliocast.com/privacy` resolves with HTTP 200 in a fresh browser before re-submitting |
| Manifest validation fails on icon dimensions | Missing 32px or asymmetric dimensions | Check `icons/` for all four sizes; regenerate if needed (see `docs/design/icon_prompts.md`) |
| Avatar shows wrong account at dashboard | Multi-account hazard | Sign out fully, close Chrome, re-open, choose `cto@thrivetech.ai` from picker; full diagnostic in [`30004-cws-account-setup.md`](./30004-cws-account-setup.md) |

## 15. Release notes

Per-version release notes live in `docs/releases/` with the naming convention:

- `chrome-vX.Y.Z.md` — Chrome Web Store release

Each file should contain:

1. **Public-facing notes** — what users see in the store listing's "What's New" section
2. **Reviewer notes** — what the CWS reviewer sees (permission justifications summary, smoke-test instructions, strict-local evidence)
3. The previous version number and the submission date

Create the release notes file **before** §4 Build — it serves as the source of truth for the dashboard's text fields, so you're not typing them live into a web form.

Current per-version files in this repo:
- [`docs/releases/chrome-v1.4.1.md`](../releases/chrome-v1.4.1.md) — v1.4.1 (first submitted version)

## 16. Related documents

- [`30001-development-runbook.md`](./30001-development-runbook.md) — dev-mode setup, test workflow, versioning policy
- [`30003-cloudflare-pages-setup.md`](./30003-cloudflare-pages-setup.md) — CFP setup for cliocast.com
- [`30004-cws-account-setup.md`](./30004-cws-account-setup.md) — CWS publisher account creation, registration, multi-account hazard, identity verification
- `docs/releases/` — per-version release notes archive
- `PRIVACY.md` — public privacy policy
- `SECURITY.md` — threat model and vulnerability reporting
- `extensions/manifest.json` — ground-truth permission declaration

## 17. Change log

| Version | Date | Change |
|---------|------|--------|
| 7 | 2026-05-28 3:40:27 PM Central | §7d Category corrected: `Productivity` is a CWS meta-header (not selectable). Paste-block changed to `Tools`. Added preamble explaining the meta-header structure and a rationale list naming each rejected option and why, so the choice survives future maintainers. Closes #180. |
| 6 | 2026-05-28 3:26:11 PM Central | §4 restructured for symmetry with §3. Renamed `Build the ZIP` → `Build & verify the ZIP`. New §4a Build (the build_release.py invocation + fallback). Existing §4a Verify renumbered to §4b Verify. Both substeps carry the `(agent does this)` label explicitly. §0 invoke-table updated: `Run §4` triggers build + verify, not "build only". Closes #178. |
| 5 | 2026-05-28 3:23:56 PM Central | §7c Long Description gets new "IF CLIO HELPS YOU" closing section asking for a Chrome Web Store review or GitHub star. Framed as "help others discover this useful extension" — not begging-tone. Closes #175. |
| 4 | 2026-05-28 2:52:36 PM Central | Added §0 "Invoke the agent" command table with canonical phrases (`Audit 30002`, `Run pre-flight`, `Run §3a`, `Run §4`, `Submitted`, `Run post-publish <URL>`). Added "Throughout this runbook" definitions stanza for operator/agent, and a tracking-issue header link to #95. §11.3 moved from operator to agent (`gh issue comment 95` for the submitted-on timestamp). §12 split into §12a Agent (README + docs/index.html install-link PRs, tag, comment+close #95) and §12b Operator (clean-profile install + three-site smoke tests + chrome://extensions verify). §3b.3 reframed: §3a.12 (new) has agent pre-describe screenshot content; operator approves the flag-list. §3a.13 (new): agent reports current `main` HEAD SHA and runbook version line so operator can verify printed copy without doing the pull themselves. §3b.4 simplified to "review §7/§8/§9 paste-blocks" (drop reference to the listing-copy.md redirect stub). §3a.1, §3a.2, §3a.4 tightened. §16 drops "Aletheia runbook 10905" — provenance stays in v1 changelog entry. §4 documents that `build_release.py` removes stale `dist/clio-chrome-v*.zip` files before producing the new artifact. Closes #168, #169, #170, #171. |
| 3 | 2026-05-28 | Numbered §3a items (1–11) and §3b items (1–5). New §3a.11: agent confirms listing-screenshot files exist at 1280×800 PNG. §3b.3 narrowed to visual privacy review of screenshot content. §4 Build explicitly labeled an agent task; operator only receives the ZIP path. §3a.4 refined: debug-tier console calls banned, `console.error` in try/catch that also surfaces to user UI is allowed. §3a.7 softened: lint is aspirational; if no script, file a tracking issue (#165) and don't block ship. §7 / §8 / §9 inlined as paste-ready blocks. `docs/listing-copy.md` reduced to a stub redirect. Closes #162, #163, #164, #166. |
| 2 | 2026-05-28 | Added version/date header and "how to verify you have the latest copy" section. Numbered all top-level sections §1–§17. Added §1 Quick Start with Path A / Path B / Path C reading-path matrix. Split §3 Pre-flight into §3a Agent and §3b Operator. Moved account-setup material (multi-account hazard, one-time developer registration, first-machine verification) to [`30004-cws-account-setup.md`](./30004-cws-account-setup.md); 30002 now keeps only the in-line §2 Account check. Added `scripting` and `*.googleusercontent.com` permission justifications to §9. Updated privacy-policy URL to `cliocast.com/privacy`. Closes #159, #160. |
| 1 | 2026-05-22 | Initial Clio-adapted version (forked from Aletheia runbook 10905). |
