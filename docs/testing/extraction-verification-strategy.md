# Verifying Clio's Batch Extraction — A Testing Strategy

> Written 2026-07-09, after the first browser run of Download-All (#200) surfaced six anomalies
> (#204–#209) that unit tests alone did not catch.

## 1. Why this is hard

Clio scrapes a **live, changing** SPA. That defeats the usual testing reflex:

- **Selectors drift.** The site's DOM changes without notice. Clio has shipped a wrong selector to production twice (PR #26, PR #40) precisely because a hand-crafted fixture diverged from reality.
- **Hand-crafted fixtures give false confidence.** A test that asserts against DOM *I invented* proves the parser matches *my assumption*, not the site.
- **The output is too big to eyeball.** 223 ZIPs. Every one of the six anomalies (dropped turns, CSS bleeding into text, missing citations, blank turns, favicon noise, doubled titles) was invisible until a file was opened and measured. "I looked and it seemed fine" is not verification.

So the strategy has one spine: **test against reality, and check it with an independent oracle.**

## 2. What I can actually do (honest capability inventory)

| Capability | Autonomous? | What it catches |
|---|---|---|
| Run the jest suite (jsdom + fake-indexeddb) | Yes | Logic + parsing regressions, offline |
| Read the downloaded ZIPs on disk | Yes | Real output content (Unicode, CSS bleed, structure) |
| Read the extension's self-instrumented run report | Yes | Enumerated count, per-conversation outcome, failures |
| **Diff extraction against the data-API oracle** | Yes | Missing turns, missing users, content gaps |
| Drive an end-to-end run | **Needs a login** | The whole pipeline in a real browser |

The one thing I cannot do alone is **produce** live output — that needs a logged-in session (the operator's single click, or a Playwright login). Everything *after* output exists — reading, diffing, asserting, reporting — I do myself, with no relay. That division is the point of the self-instrumenting run report (#201): the operator clicks once; I verify.

## 3. The oracle — the load-bearing idea

For every Claude conversation there are **two independent sources of truth**:

1. what the **DOM extractor** produced (what ships), and
2. the **site's own data API** (`/api/organizations/{org}/chat_conversations/{id}`), already exported to `data/claude-export/`.

The API is structurally clean (typed JSON: message list, roles, timestamps) and was captured independently. Diffing (1) against (2) is the strongest check available for a scraper, because a bug has to corrupt *both* to hide. It is how "conv 103 = 10 messages" was caught against the oracle's "18." The API is a weak oracle for *rendered* content (it omits artifact bodies — the reason we scrape the DOM at all), but a strong oracle for **structure**: how many turns, in what order, by whom.

## 4. The five verification layers (cheap → expensive)

1. **Unit tests vs real-DOM fixtures.** Every selector/parse assertion runs against DOM captured from the real site (F1 harness), never invented. Fast, offline. *(319 tests today.)*
2. **Oracle diff (Layer of record).** Per conversation, compare DOM output vs the API export: message count, role sequence, text-containment, Unicode integrity, style-leak, citation presence, attachment accounting. This automates the manual audit and turns each anomaly into a machine assertion.
3. **Self-instrumented run report.** The extension records what it saw and downloads it; I read it against ground truth with no operator relay. *(Shipped, #201.)*
4. **Corpus invariants.** A fixed property set every conversation must satisfy (count > 0 or flagged-empty; first turn is a user turn; roles alternate or are explained; no `<style>`/`<script>` text; no `U+FFFD`; cited domains present for research turns). Run over all 223; violations are the work-list.
5. **End-to-end browser run.** Load unpacked → Download All → inspect output vs oracle. The final gate before any release.

## 5. Each anomaly becomes a regression assertion

| Issue | Assertion that catches it | Layer |
|---|---|---|
| #204 dropped turns | `dom.messageCount >= oracle.messageCount` (± explained) | 2 |
| #205 missing user turn | `messages[0].role === 'user'` (or shape documented) | 2/4 |
| #206 CSS in content | `!/@keyframes|<style/.test(content)` | 1/4 |
| #207 missing citations | research turn → cited domains present in text | 2/4 |
| #208 blank assistant turn | no message with empty `content` | 1/4 |
| #209 doubled titles | `cleanTitle('X X') === 'X'` | 1 |

Every fix ships **with** its assertion, so the anomaly cannot silently return.

## 6. Proposed artifact: `tools/verify_export.py`

Operationalize Layers 2 + 4 as one reusable harness:

```
verify_export  <downloaded clio-archive/ dir>  <data/claude-export oracle dir>
  → per-conversation diff + a corpus anomaly report (exit non-zero if any invariant fails)
```

It reads each ZIP's `conversation.json`, pairs it with the oracle by conversation id, and emits the same table this audit produced by hand — but repeatably, on every run, as a gate. House-style Python under `tools/` (see `build_release.py`); stdlib `zipfile` + `json` only.

## 7. Definition of "verified"

A run is **verified**, not merely "done," when:

- enumerated count **==** oracle count (no silent truncation);
- per-conversation message count is within tolerance of the oracle, or the gap is explained (genuinely-empty / known branch);
- **zero** corpus-invariant violations (§4.4);
- every run-report failure is a genuinely-empty or otherwise-explained conversation.

Anything short of that is "it ran," which — as the six anomalies show — is not the same thing.
