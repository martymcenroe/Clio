# 30002 — Chrome Web Store Publishing

## Purpose

Step-by-step instructions for publishing Clio extension updates to the Chrome Web Store. Covers building, uploading, listing maintenance, and post-publish verification. This is the canonical procedure for both first submission and every subsequent update — follow it end to end, do not skip "obvious" steps.

Adapted from Aletheia's runbook 10905; Clio differs in being Chrome-only (no Firefox AMO) and having a substantially smaller permission surface.

## Account

| Store | Account | Dashboard |
|-------|---------|-----------|
| Chrome Web Store | Personal developer account (see local credentials store) | https://chrome.google.com/webstore/devconsole |

Firefox AMO is *not* in scope for the initial 1.4.0 launch. A future issue will track Firefox publication; the extension currently only ships for Chromium browsers.

## Pre-flight checklist

Before publishing, verify:

- [ ] `extensions/manifest.json` has the correct new `version` number
- [ ] `host_permissions` contains exactly `gemini.google.com`, `claude.ai`, `chatgpt.com` — no more, no less
- [ ] `permissions` contains exactly `activeTab`, `downloads`
- [ ] No dev/debug code (no `console.log` lingering, no hardcoded URLs, no test flags) — see `chrome-web-store` issue #83 for the pre-launch sweep
- [ ] All tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`) with no warnings
- [ ] Version is NOT already published — check the dashboard before bumping
- [ ] The version-bump change is merged to `main` (do not build from a feature branch)
- [ ] `CHANGELOG.md` has a dated entry for this version, not `Unreleased`

## Build the ZIP

**CRITICAL:** Always use `zip` from MSYS2 / Git Bash. **Never** use PowerShell `Compress-Archive` — it writes backslash path separators, which the Chrome Web Store reviewer flags as malformed.

**CRITICAL:** Verify the `extensions/` directory contains only extension files — no `docs/`, `tests/`, `tools/`, `node_modules/`, or other non-extension content. If a stray file slipped into the directory, fix that *before* building.

```bash
cd /c/Users/mcwiz/Projects/Clio
python tools/build_release.py  # produces dist/clio-chrome-vX.Y.Z.zip
```

If `tools/build_release.py` does not yet exist for this version of the repo, fall back to a direct `zip` invocation:

```bash
cd /c/Users/mcwiz/Projects/Clio/extensions
zip -r ../dist/clio-chrome-vX.Y.Z.zip . -x '.*' -x '*/.*' -x 'node_modules/*'
```

### Verify the ZIP

```bash
cd /c/Users/mcwiz/Projects/Clio
unzip -l dist/clio-chrome-vX.Y.Z.zip
```

Confirm:

- Forward slashes in all listed paths (no backslashes)
- `manifest.json` present at the archive root
- `src/`, `icons/` present
- 4 icons: 16, 32, 48, 128
- No unexpected files (docs, session logs, dotfiles, dev-only scratch files)

A sanity check on the manifest version inside the ZIP:

```bash
unzip -p dist/clio-chrome-vX.Y.Z.zip manifest.json | grep '"version"'
```

The reported version must match the ZIP filename.

## Upload to the Chrome Web Store

1. Go to https://chrome.google.com/webstore/devconsole
2. Sign in as the documented Clio developer account
3. Find **Clio** in the extension list — or click **New Item** for the first publish
4. Click **Package** → **Upload new package**
5. Upload `dist/clio-chrome-vX.Y.Z.zip`
6. Wait for validation — fix any errors before proceeding

## Store listing

Update if changed (see `docs/listing-copy.md` for the canonical text):

| Field | Value |
|-------|-------|
| Name | Clio |
| Short Description | (132 char max) — see `docs/listing-copy.md` |
| Long Description | — see `docs/listing-copy.md` |
| Category | Productivity |
| Language | English |

## Privacy tab

| Field | Value |
|-------|-------|
| Single Purpose | Extract LLM conversations from supported assistant sites (Gemini, Claude, ChatGPT) to local JSON files for user-side archival |
| Privacy Policy URL | `https://martymcenroe.github.io/Clio/privacy.html` *(verify the GH Pages site is live before submission; see #88)* |
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
| Personal communications | **Yes** | The conversation text the user is viewing. Processed locally, never transmitted off-device. |
| Location | No | — |
| Web history | No | — |
| User activity | No | — |
| Website content | **Yes** | DOM of the active tab on the three declared LLM sites only, on user-initiated extraction. Processed locally. |

## Permission justifications

| Permission | Justification |
|------------|---------------|
| `activeTab` | Required to read the conversation DOM in the user's current tab when they press the extension's toolbar button. Activated by user gesture only; not a standing capability. |
| `downloads` | Required to write the extracted ZIP to the user's local disk via Chrome's "Save As" dialog. This is the only way the extension writes any data anywhere. |
| `host_permissions: gemini.google.com, claude.ai, chatgpt.com` | The three LLM products Clio supports. Content scripts walk the DOM on these origins only to enumerate conversation turns. No other origin is contacted. |

If a reviewer asks why these justifications are unusually short: because the extension genuinely does very little. The minimum-surface-area posture is documented in `SECURITY.md` and the wiki's Defense in Depth page.

## Pricing & distribution

| Field | Value |
|-------|-------|
| License | MIT (see [LICENSE](../../LICENSE)) |
| Visibility | Public |
| Regions | All regions |
| Pricing | Free |

## Submit for review

1. Click **Submit for review**
2. Chrome review typically takes 1–3 business days
3. Note the submission date and time in GitHub issue #95

## Post-publish verification

After the extension is approved and live:

1. Install from the Chrome Web Store listing on a clean Chrome profile
2. **Gemini smoke test:** open a Gemini conversation → click the Clio toolbar icon → click Extract → verify a valid ZIP downloads and the JSON parses
3. **Claude smoke test:** repeat on a Claude conversation
4. **ChatGPT smoke test:** repeat on a ChatGPT conversation
5. Check the version number in `chrome://extensions` matches what was uploaded
6. Update the README install link to the live CWS URL (separate PR)
7. Update `docs/index.html` install link (separate PR)
8. Tag the released commit on the repo: `git tag vX.Y.Z-published && git push origin vX.Y.Z-published`
9. Note the approval date and live URL in GitHub issue #95, then close it

If any smoke test fails: do **not** delist immediately. File a `launch-blocker` issue, reproduce in dev mode, fix and ship a patch version. A version on the store that mostly works is recoverable; a removed listing has to go through review again from scratch.

## Version bump procedure

When preparing a new release:

1. Open a GitHub issue describing the release contents — link to the closed work that's bundled in
2. Update `extensions/manifest.json` → `"version": "X.Y.Z"`
3. Update `CHANGELOG.md` `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD` with the actual release contents
4. Commit: `chore: bump extension version to X.Y.Z (Closes #N)`
5. Merge to `main`
6. Then follow the build and upload steps above

## Troubleshooting

| Problem | Diagnosis | Action |
|---------|-----------|--------|
| CWS rejects ZIP with "invalid path" or backslash error | ZIP built with PowerShell | Rebuild with `zip` (MSYS2/Git Bash) |
| "Version already exists" | Forgot to bump | Update manifest, re-build |
| Chrome review rejection (permission justification) | Reviewer wants more detail | Read the rejection carefully — usually a specific permission needs a more concrete user-benefit framing; do not dilute the justification just to satisfy them |
| Extension ZIP contains unexpected files | Stray dev artifacts under `extensions/` | Locate and remove; verify `extensions/` is *only* extension files before re-zipping |
| Privacy Policy URL "not reachable" | GH Pages not live yet | Wait for #88 to land; verify URL resolves before re-submitting |
| Manifest validation fails on icon dimensions | Missing 32px or asymmetric image dimensions | Check `icons/` for all four sizes; regenerate if needed (see `docs/design/icon_prompts.md`) |

## Release notes

Per-version release notes live in `docs/releases/` with the naming convention:

- `chrome-vX.Y.Z.md` — Chrome Web Store release

Each file should contain:

1. **Public-facing notes** — what users see in the store listing's "What's New" section
2. **Reviewer notes** — what the CWS reviewer sees (permission justifications, testing instructions if non-obvious)
3. The previous version number and the submission date

Create the release notes file *before* uploading — it serves as the source of truth for the dashboard's text fields, so you're not typing them live into a web form.

## Related documents

- `docs/releases/` — release notes archive
- `docs/listing-copy.md` — canonical store-listing text (name, descriptions, category)
- `docs/runbooks/30001-development-runbook.md` — dev-mode setup, test workflow
- `PRIVACY.md` — public privacy policy
- `SECURITY.md` — threat model and vulnerability reporting
- `extensions/manifest.json` — the ground-truth permission declaration
- Aletheia runbook 10905 — original source this was adapted from
