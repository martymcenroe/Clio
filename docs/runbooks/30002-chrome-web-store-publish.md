# 30002 — Chrome Web Store Publishing (Clio)

> **Version:** 2
> **Last updated:** 2026-05-28
> **Applies to:** Clio Chrome extension, every submission to the Chrome Web Store
> **Account-setup material:** moved to [`30004-cws-account-setup.md`](./30004-cws-account-setup.md)

## How to verify you have the latest copy

This runbook lives at `docs/runbooks/30002-chrome-web-store-publish.md` in [martymcenroe/Clio](https://github.com/martymcenroe/Clio). The **Version** and **Last updated** lines above identify which revision you're holding.

To compare a printed copy against the canonical:

1. Note the version number on your copy
2. From the repo, `git pull --ff-only` on `main`
3. Open the freshly-pulled file and check the version line
4. If the version differs, re-print before continuing

The §17 Change log at the bottom of this file lists every version with what changed.

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

Split by responsibility. Agent items happen in the repo. Operator items happen on the publishing machine and dashboard. Each party checks their own before handing off.

### 3a. Agent does (in the repo, before producing the ZIP)

- [ ] `extensions/manifest.json` has the new `version` value, monotonically increasing from the last published version
- [ ] `host_permissions` is exactly `gemini.google.com`, `claude.ai`, `chatgpt.com` plus any image hosts already justified (currently `https://*.googleusercontent.com/*` for Gemini images)
- [ ] `permissions` is exactly `activeTab`, `downloads`, `scripting`
- [ ] No `console.log` / `console.debug` / `console.info` / `console.warn` / `console.error` left in shipped `extensions/src/*.js` (the v1.4.0 → v1.4.1 patch was driven by exactly this miss)
- [ ] No hardcoded test URLs, dev flags, or scratch code
- [ ] All tests pass: `npm test`
- [ ] Lint clean: `npm run lint` (no warnings, not just no errors)
- [ ] Version bump merged to `main` — build from `main`, never a feature branch
- [ ] `CHANGELOG.md` has a dated entry for this version (not `[Unreleased]`)
- [ ] Release notes file `docs/releases/chrome-vX.Y.Z.md` written before upload — see §15

### 3b. Operator does (on the publishing machine)

- [ ] §2 Account check passes — Publisher chip reads `ThriveTech.ai` and avatar email is `cto@thrivetech.ai`
- [ ] The version isn't already in the dashboard — for Path B updates, check the Package tab's version-history. For Path A first submissions, Clio doesn't exist in the Items list yet, so this is auto-pass.
- [ ] Listing screenshots ready at the required resolution (1280×800 PNG) with no operator-personal info visible
- [ ] `docs/listing-copy.md` reviewed (or intentionally skipped) for any text changes since last submission
- [ ] This runbook's version line matches `main` (see "How to verify you have the latest copy" above)

If any agent box is unchecked, the agent rebuilds before handing off the ZIP. If any operator box is unchecked, the operator pauses before clicking Upload.

## 4. Build the ZIP

**CRITICAL:** Use `zip` from MSYS2 / Git Bash. Never PowerShell `Compress-Archive` — it writes backslash separators, which the CWS reviewer flags as malformed.

**CRITICAL:** `extensions/` must contain only extension files. No `docs/`, `tests/`, `tools/`, `node_modules/`, or other content. Verify before zipping.

```bash
cd /c/Users/mcwiz/Projects/Clio
python tools/build_release.py  # produces dist/clio-chrome-vX.Y.Z.zip
```

Fallback if `tools/build_release.py` is missing or broken:

```bash
cd /c/Users/mcwiz/Projects/Clio/extensions
zip -r ../dist/clio-chrome-vX.Y.Z.zip . -x '.*' -x '*/.*' -x 'node_modules/*'
```

### 4a. Verify the ZIP

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

Update fields if changed. Canonical text lives in `docs/listing-copy.md` — paste from there rather than typing.

| Field | Value / Source |
|-------|---------------|
| Name | Clio |
| Short Description | 132 char max — see `docs/listing-copy.md` |
| Long Description | See `docs/listing-copy.md` |
| Category | Productivity |
| Language | English |

## 8. Privacy tab

| Field | Value |
|-------|-------|
| Single Purpose | Extract LLM conversations from supported assistant sites (Gemini, Claude, ChatGPT) to local JSON files for user-side archival |
| Privacy Policy URL | `https://cliocast.com/privacy` |
| Handles user data? | Yes — page content (conversation text and images visible in the active tab) |
| Sold to 3rd parties? | No |
| Used for unrelated purposes? | No |
| Used for creditworthiness or lending? | No |

### Data usage disclosures (Chrome's mandatory checklist)

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

| Permission | Justification |
|------------|---------------|
| `activeTab` | Required to read the conversation DOM in the user's current tab when they press the extension's toolbar button. Activated by user gesture only; not a standing capability. |
| `downloads` | Required to write the extracted ZIP to the user's local disk via Chrome's "Save As" dialog. The only way the extension writes data anywhere. |
| `scripting` | Required for the auto-recovery path when the content script's listener has been torn down (typically after a tab reload). Used only after a "Receiving end does not exist" error, only on the active tab, only to inject Clio's own bundled scripts. |
| `host_permissions: gemini.google.com, claude.ai, chatgpt.com` | The three LLM products Clio supports. Content scripts walk the DOM on these origins only to enumerate conversation turns. |
| `host_permissions: https://*.googleusercontent.com/*` | Required to fetch images embedded in Gemini conversations for inclusion in the extracted ZIP. Read-only image fetches, only when extracting a Gemini conversation. |

If a reviewer asks why the justifications are unusually short: because the extension genuinely does very little. The minimum-surface-area posture is documented in `SECURITY.md` and the wiki's Defense in Depth page.

## 10. Pricing & distribution

| Field | Value |
|-------|-------|
| License | MIT (see [LICENSE](../../LICENSE)) |
| Visibility | Public |
| Regions | All regions |
| Pricing | Free |

## 11. Submit for review

1. Click **Submit for review**
2. Chrome review typically takes 1–3 business days
3. Note the submission date and time in GitHub issue #95

## 12. Post-publish verification

After the extension is approved and live:

1. Install from the CWS listing on a clean Chrome profile
2. **Gemini smoke test:** open a Gemini conversation → click the Clio toolbar icon → click Extract → verify a valid ZIP downloads and the JSON parses
3. **Claude smoke test:** repeat on a Claude conversation
4. **ChatGPT smoke test:** repeat on a ChatGPT conversation
5. Verify `chrome://extensions` shows the version that was uploaded
6. Update the README install link to the live CWS URL (separate PR)
7. Update `docs/index.html` install link (separate PR)
8. Tag the released commit: `git tag vX.Y.Z-published && git push origin vX.Y.Z-published`
9. Note the approval date and live URL in #95, then close it

If any smoke test fails: do **not** delist immediately. File a `launch-blocker` issue, reproduce in dev mode, fix and ship a patch version. A version on the store that mostly works is recoverable; a removed listing has to go through review from scratch.

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
2. **Reviewer notes** — what the CWS reviewer sees (permission justifications, testing instructions if non-obvious)
3. The previous version number and the submission date

Create the release notes file **before** uploading — it serves as the source of truth for the dashboard's text fields, so you're not typing them live into a web form.

## 16. Related documents

- [`30001-development-runbook.md`](./30001-development-runbook.md) — dev-mode setup, test workflow, versioning policy
- [`30003-cloudflare-pages-setup.md`](./30003-cloudflare-pages-setup.md) — CFP setup for cliocast.com
- [`30004-cws-account-setup.md`](./30004-cws-account-setup.md) — CWS publisher account creation, registration, multi-account hazard, identity verification
- `docs/listing-copy.md` — canonical store-listing text (name, descriptions, category)
- `docs/releases/` — per-version release notes archive
- `PRIVACY.md` — public privacy policy
- `SECURITY.md` — threat model and vulnerability reporting
- `extensions/manifest.json` — ground-truth permission declaration
- Aletheia runbook 10905 — original source this was adapted from

## 17. Change log

| Version | Date | Change |
|---------|------|--------|
| 2 | 2026-05-28 | Added version/date header and "how to verify you have the latest copy" section. Numbered all top-level sections §1–§17. Added §1 Quick Start with Path A / Path B / Path C reading-path matrix. Split §3 Pre-flight into §3a Agent and §3b Operator. Moved account-setup material (multi-account hazard, one-time developer registration, first-machine verification) to [`30004-cws-account-setup.md`](./30004-cws-account-setup.md); 30002 now keeps only the in-line §2 Account check. Added `scripting` and `*.googleusercontent.com` permission justifications to §9. Updated privacy-policy URL to `cliocast.com/privacy`. Closes #159, #160. |
| 1 | 2026-05-22 | Initial Clio-adapted version (forked from Aletheia runbook 10905). |
