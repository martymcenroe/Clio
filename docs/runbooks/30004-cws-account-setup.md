# 30004 — Chrome Web Store Account Setup (New Extension Starter)

> **Version:** 1
> **Last updated:** 2026-05-28
> **Applies to:** Any new Chrome extension before its first CWS submission, or any first-time login from a new machine / new Chrome profile

## Purpose

Pre-conditions for getting an extension onto the Chrome Web Store under the `cto@thrivetech.ai` publisher: account verification, multi-account hazard, one-time developer registration, dashboard orientation. Once these are satisfied, hand off to the extension-specific publishing runbook (e.g. Clio's [`30002-chrome-web-store-publish.md`](./30002-chrome-web-store-publish.md)).

If the account already publishes to CWS and you're verifying you're signed in correctly on a familiar machine, that's a single check — done inline in the extension-specific runbook (Clio's §2 Account check). This document covers the cases where that single check is not enough:

- A new Chrome profile or new machine has not yet signed in to the dashboard, OR
- A new publisher account is being created from scratch, OR
- The multi-account hazard has bitten the operator and they need the full diagnostic.

## How to verify you have the latest copy

This runbook lives at `docs/runbooks/30004-cws-account-setup.md` in [martymcenroe/Clio](https://github.com/martymcenroe/Clio). The **Version** and **Last updated** lines above identify which revision you're holding. To compare against the canonical: `git pull --ff-only` on `main` and check the version line in the freshly-pulled file.

## 1. Account

| Store | Account | Dashboard |
|-------|---------|-----------|
| Chrome Web Store | `cto@thrivetech.ai` | https://chrome.google.com/webstore/devconsole |

This is the developer account that Aletheia, Clio, and any future ThriveTech extensions publish under. The one-time $5 USD developer-registration fee has already been paid against this account — no additional fee for new extensions under it.

## 2. Multi-account hazard

This Google identity is one of many Google accounts the publisher may be signed in to in any given Chrome profile. Selecting the wrong account at the dashboard sign-in step is the most common source of "I can't find my extension" confusion at upload time.

### 2a. Verifying the active identity

1. Open a new Chrome window. Go to https://chrome.google.com/webstore/devconsole
2. If Chrome prompts for account selection, **carefully choose `cto@thrivetech.ai`** — not any other Google account that may be signed in. The chooser shows each account's display name and avatar; verify the email at the bottom of the chooser tile before clicking.
3. If signed in to a different account, sign out completely first (https://accounts.google.com/Logout) — do **not** use "Add another account" alongside other Google sessions; the dashboard sometimes silently uses the default browser identity rather than the intended one.
4. Once in the dashboard, confirm in the **top-right** header that the **Publisher** chip reads `ThriveTech.ai`, and that the avatar's account email (click avatar to see) is `cto@thrivetech.ai`. If anything else, abort and re-do step 2.

## 3. One-time developer registration (already done for `cto@thrivetech.ai`)

Documented here for future maintainers. If a new CWS publisher account ever needs to be created:

1. Sign in to the dashboard at the URL above with the new Google identity
2. Accept the Chrome Web Store Developer Agreement
3. Pay the **one-time $5 USD registration fee** (Google Pay or credit card)
4. Verify a contact email address — Google sends a verification email; the link must be clicked from the same browser session
5. The account is now eligible to publish

For `cto@thrivetech.ai` this is already done. The account currently has Aletheia published; Clio and any future extensions inherit that registration.

## 4. Item list orientation

After verifying the account, the dashboard's main view is the **Items** list — a left sidebar with each extension this account publishes. For a new extension's first upload, the new extension will not appear in this list until the New Item flow completes (see the extension-specific runbook). For subsequent updates, the extension appears with its current version, last update date, and review status.

Items list state as of this runbook's last-updated date:

| Item | Version | Type | Created | Last updated | Status |
|------|---------|------|---------|--------------|--------|
| Aletheia | 1.1.2 | Extension | Jan 8, 2026 | May 25, 2026 | Published — public |

Once Clio's first **+ New item** flow completes, Clio will appear as a second row.

## 5. Next steps

Once the account is verified per this runbook, return to the extension-specific publishing runbook:

- **Clio** → [`30002-chrome-web-store-publish.md`](./30002-chrome-web-store-publish.md), pick the reading path (Path A first submission, Path B subsequent update)
- **Future ThriveTech extensions** → that extension's own 3000X runbook (create following Clio's 30002 as a template)

## 6. Related documents

- [`30002-chrome-web-store-publish.md`](./30002-chrome-web-store-publish.md) — Clio publishing runbook (recurring submission flow)
- Aletheia runbook 10905 — original source the Clio runbook was adapted from

## 7. Change log

| Version | Date | Change |
|---------|------|--------|
| 1 | 2026-05-28 | Initial — extracted account-setup boilerplate from `30002-chrome-web-store-publish.md` so 30002 stays focused on the recurring submission flow. Closes #160. |
