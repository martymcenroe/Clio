# 0201 - ADR: System Chrome Channel for Playwright Automation Against Anti-Automation-Gated Sites

**Status:** Implemented (Option A + Option B — see §7)
**Date:** 2026-04-22
**Categories:** Infrastructure, Process

> **Update 2026-04-22 (same day):** Option B (persistent user-data-dir) was escalated into implementation alongside Option A after first live run showed that per-run login was untenable — the Claude test died mid-navigation and would have required re-login anyway. Both options now ship in `tests/e2e/dom-discovery.spec.js` (issue #81). Section 7 reflects the current state; Section 3 Option B is no longer "reserved."

## 1. Context

Clio's DOM-discovery harness (`tests/e2e/dom-discovery.spec.js`, issue #47) drives a Playwright browser to Gemini, Claude, and ChatGPT to reconnoiter their sidebar DOM structure. On first live run (issue #75), signing into `gemini.google.com` with Playwright's bundled Chromium failed at the Google sign-in page BEFORE any credentials could be entered:

> Couldn't sign you in. This browser or app may not be secure.
> Try using a different browser.

The block is deterministic, not transient — retrying, clearing cookies, or waiting does not resolve it. The cause is browser fingerprinting. Google's sign-in path rejects clients whose signature matches known automation stacks. Playwright's default configuration presents at least three such signals:

1. **Bundled Chromium has a subtly different binary + TLS fingerprint** than user-installed Chrome (different build flags, revision cadence, TLS cipher order)
2. **Playwright injects `navigator.webdriver = true`** at runtime — a one-line check Google can inspect
3. **The bundled Chromium channel presents a fresh / history-less profile** with no accumulated behavioral heuristics

This affects any Playwright-based automation that needs to sign into Google properties, and likely any automation targeting enterprise SaaS with bot detection (Microsoft / Azure AD, Okta, Duo, etc.). For Clio specifically, the DOM-discovery harness is the first case, but Clio 2.0's #60 (batch full-extraction worker) will eventually hit the same wall when running unsupervised.

## 2. Decision

**We will launch Playwright automation targeting anti-automation-gated sites using the system Chrome channel with Blink's automation-controlled feature disabled, scoped per-spec (not globally).**

Concretely, the affected spec adds:

```js
test.use({
  channel: 'chrome',
  launchOptions: {
    args: ['--disable-blink-features=AutomationControlled']
  }
});
```

Other tests (`tests/viewer.e2e.test.js` and future accessibility/viewer suites) continue using Playwright's bundled Chromium because they do not sign into gated properties and don't need the system-Chrome dependency.

## 3. Alternatives Considered

### Option A: `channel: 'chrome'` + `--disable-blink-features=AutomationControlled` — SELECTED

**Description:** Launch the user's installed Chrome instead of bundled Chromium; strip the `navigator.webdriver` runtime signal.

**Pros:**
- Uses the user's existing Chrome binary — matches real-user fingerprint end-to-end
- Minimal Playwright API surface — one `test.use()` block per spec
- `--disable-blink-features=AutomationControlled` is a canonical, well-documented workaround in the Playwright / Puppeteer ecosystems
- Scoping per-spec keeps other tests fast and dependency-free

**Cons:**
- Requires system Chrome installed (negligible for Chrome-extension developers; real consideration for CI)
- CI/CD pipelines must include Chrome in their image to run affected specs
- Future Chrome versions could theoretically tighten fingerprinting; escalation path exists (Option B)

### Option B: Persistent user-data-dir with a pre-logged-in profile — Not Selected (reserved as escalation)

**Description:** Use `chromium.launchPersistentContext(userDataDir, {...})` pointing at a dir where the user pre-authenticated. Sign-in state is cached across runs.

**Pros:**
- Strongest dodge — the browser looks like a returning user, not a fresh sign-in attempt
- Bypasses sign-in blocks AND 2FA prompts on subsequent runs

**Cons:**
- Profile management complexity — first-run flow is still manual, subsequent profile rot is possible
- Stored session tokens in the profile dir are a minor secrets-hygiene concern (user's home-dir, not repo)
- AssemblyZero ADR-0209 already covers a persistent-context pattern for extension-internal testing; mixing that purpose with an anti-automation dodge blurs that ADR's scope
- Not needed yet — Option A is sufficient for Clio's current harness

Reserved as the escalation path if Google tightens further and Option A ceases to work.

### Option C: User-agent spoofing alone — Rejected

**Description:** `page.setExtraHTTPHeaders({ 'User-Agent': '<real Chrome UA>' })` while keeping bundled Chromium.

**Cons:**
- Google checks TLS fingerprint and JavaScript-accessible properties (`navigator.webdriver`, `navigator.plugins`, canvas fingerprint) — UA alone is insufficient ← deciding factor
- Creates HTTP/JS inconsistency some detectors explicitly flag

### Option D: Firefox — Rejected

**Description:** Route anti-automation-blocked specs to Firefox via `browserName: 'firefox'`.

**Cons:**
- Google is MORE aggressive against non-Chrome user agents on Google properties
- Doesn't solve the fingerprint problem; moves it to a less-favored browser stack

### Option E: Manual-only testing — Rejected

**Description:** Don't automate. Use DevTools by hand for DOM discovery.

**Cons:**
- Defeats the harness's purpose
- The pain of manual DevTools snippet iteration is captured in `memory/feedback_verify_dom_extraction.md` — ~40 retries across 4 accounts is what the harness is meant to eliminate

## 4. Rationale

Option A wins because it works today with minimal complexity. System Chrome has the fingerprint Google allows; `--disable-blink-features=AutomationControlled` is a single extra `args` entry. Cost: one `test.use` block in the affected spec plus a prerequisite note in the runbook.

Key deciding factors:

- **Proven pattern** — `--disable-blink-features=AutomationControlled` is the canonical workaround documented across Playwright / Puppeteer / Selenium ecosystems for years
- **Small blast radius** — scoped per-spec, no global config change, no effect on unrelated tests
- **Escalation path preserved** — if Google tightens further, Option B (persistent profile) is available without retracting this ADR

Trade-offs accepted:

- CI/CD pipelines that run affected specs must include Chrome (or skip the spec)
- Silent drift if Chrome auto-updates to a version with a changed fingerprint check — low likelihood, easy to spot when harness suddenly fails sign-in

## 5. Security Risk Analysis

| Risk | Impact | Likelihood | Severity | Mitigation |
|------|--------|------------|----------|------------|
| `channel: 'chrome'` silently uses the user's real Chrome profile (leaking cookies / auth) | Medium | Low | 2 | Playwright's default for `channel: 'chrome'` via `test.use()` is a fresh temp user-data-dir, NOT the user's real profile. Verified in Playwright docs. The harness therefore cannot read real Chrome cookies. |
| `--disable-blink-features=AutomationControlled` weakens browser sandbox or origin policy | Low | Low | 1 | The flag only affects the `navigator.webdriver` signal and related detection hints. It does not affect sandboxing, same-origin policy, TLS, or extension permissions. No meaningful security surface change. |
| Chrome auto-update changes fingerprint and silently breaks automation | Low | Low | 1 | Chrome updates rarely change fingerprint. If one does, the harness will fail at sign-in loud-and-clear (not silently produce wrong data). |
| Pattern normalizes "dodge anti-automation" as a default stance | Low | Low | 1 | Scoped per-spec and documented as legitimate reconnaissance on the user's own accounts. Not used against third-party accounts or for scraping at scale. |

**Residual Risk:** Minimal. The change affects test infrastructure on one spec today (`tests/e2e/dom-discovery.spec.js`), adding at most one or two more as Clio 2.0's batch-extraction work (#60) lands.

## 6. Consequences

### Positive
- The DOM-discovery harness (and any future batch-extraction work) can actually sign into Google properties
- Pattern is reusable across projects — AssemblyZero ADR-0216 mirrors this decision for cross-project alignment
- No change to production code or user-facing behavior
- System Chrome matches what users run in real usage — extension behavior is tested against the same browser stack the extension is loaded into

### Negative
- System Chrome becomes a prerequisite for affected specs (captured in runbook)
- Future CI/CD adoption requires adding Chrome to the runner image
- Two Playwright configurations in a single repo (bundled Chromium for most tests, system Chrome for gated-site specs) — mitigated by per-spec scoping and this ADR as documentation

### Neutral
- Existing E2E tests are unchanged — scoping limits the change to specs that opt in

## 7. Implementation

- **Related Issues:** #47 (DOM-discovery harness), #75 (Option A fix), #76 (PR shipping Option A), #77 (this ADR), #81 (Option B escalation), #79 (instrumentation)
- **Related ADRs:** AssemblyZero ADR-0209 (Playwright persistent context for extension testing) — complementary, different scope. AssemblyZero ADR-0216 mirrors this ADR for cross-project reference.
- **Status:** Complete — Option A shipped in PR #76; Option B shipped in the PR closing #81 (both merged 2026-04-22).
- **Why both options ship together:** Option A (system Chrome channel) is needed to pass the fingerprint check at the sign-in page. Option B (persistent user-data-dir) is needed so login survives across test runs — without it, a mid-run failure requires re-login on the next attempt, which is untenable given sign-in time + occasional 2FA / CAPTCHA friction. Neither option alone is sufficient for a reliable harness; the two stack.
- **Pattern for new specs that need both:**
  ```js
  const { chromium } = require('@playwright/test');
  const os = require('os');
  const path = require('path');

  // Inside your test:
  const userDataDir = path.join(os.homedir(), '.<project>-profiles', site.id);
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });
  // ... use context.pages()[0] or context.newPage() ...
  await context.close();
  ```
- **When to apply:** any Playwright spec that must sign into Google, Microsoft, or comparable anti-automation-gated provider AND runs often enough that per-run login is a cost. Do NOT apply to specs that don't need it — bundled Chromium is faster and needs no external install.
- **Profile location convention:** user home dir (`~/.<project>-profiles/`), not repo-local, not `test-results/`. Outside the repo so reclones and `git clean` don't wipe sessions; outside test-results so test-result churn doesn't wipe sessions either.
- **Further escalation paths** (if both options still fail):
  - Pin a specific Chrome binary instead of the system default (`executablePath`) — defends against auto-update fingerprint drift
  - Add more launch args (e.g. `--disable-automation`, `--disable-web-security` only when essential)
  - Route through an authenticated residential proxy (last resort; significant complexity)

## 8. References

- [Playwright docs — Browser channels (Chrome / Edge)](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)
- [Playwright docs — launchPersistentContext](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context) — relevant for Option B escalation
- [Chromium `--disable-blink-features` catalog](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/platform/runtime_enabled_features.json5) — authoritative list of toggleable Blink features
- AssemblyZero ADR-0209 — Playwright Persistent Context for Extension E2E Testing (complementary scope)
- AssemblyZero ADR-0216 — mirror of this ADR for cross-project Playwright work
- Clio `memory/feedback_verify_dom_extraction.md` — why the harness matters; the pain this decision unblocks

---

## Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-04-22 | Claude Opus 4.7 (1M context) | Initial draft — shipped alongside Clio PR #76 |
