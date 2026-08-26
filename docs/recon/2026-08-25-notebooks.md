# Gemini Notebooks Recon — 2026-08-25

Recon for #241 (umbrella #246). Method: operator-paced staged capture via
`tests/e2e/notebook-recon.spec.js` — headed system Chrome, persistent
profile (ADR-0201 Options A+B), full-page DOM dumps + screenshots +
continuous network capture per stage. Two runs against the operator's
target notebook (28 sources). All raw evidence is local-only under
gitignored `data/` (see **Privacy** below); this report carries structure
only, no notebook content.

## 1. Architecture — two surfaces, two hosts

| Surface | URL | What it holds |
|---|---|---|
| Gemini landing | `gemini.google.com/notebook/{uuid}` | Title, source-count chip, "Ask Gemini" box, a "Past chats" list. In the target notebook that list was EMPTY even though the full view holds a 20-message conversation — the landing chat store is decoupled from the full view's chat (open question §7). |
| Full notebook view | `notebook.google.com/notebook/{uuid}` | The real workspace: three panels — Sources (left), Chat (center), Studio/artifacts (right). Reached via the "Gemini Notebook ↗" link on the landing page (opens a new tab). A few requests also touch `notebooklm.google.com`. |

The left-nav "Notebooks" section on the Gemini page lists notebooks and an
"All notebooks" view. The full view is the NotebookLM surface (internal
codename LabsTailwind) rebranded onto `notebook.google.com`.

## 2. API map (verified against captured payloads)

Both surfaces speak Google's `batchexecute` RPC transport:

- Landing: `gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=…&source-path=/notebook/{uuid}` — rpcids observed: `L5adhe`, `CNgdBe`, `MaZiqc`, `HcT8bb`, `ESY5D`, `aPya6c`. Not decoded — the full view supersedes the landing for every extraction goal.
- Full view: `notebook.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=…&source-path=/notebook/{uuid}`

Full-view RPCs, identified by content probes of the captured bodies:

| rpcid | Size seen | Contents (verified) | Feeds |
|---|---|---|---|
| `wXbhsf` | ~42.7 KB | **Sources list** — notebook title, then per-source `[uuid, filename, timestamps, metadata…]` | #245 inventory |
| `cFji9` | ~280 KB | **Chat history** — per-message `[uuid, markdown text, …]`; matches the 20 `chat-message` elements in the DOM | #242 conversation |
| `gArtLc` | ~36.6 KB | **Artifacts list** — per-artifact `[uuid, filename, type code, cited-source uuids…]` | #243 artifacts |
| `hizoJc` | ~45.8 KB (one audio source) | **Per-source content** — `[source uuid], filename, metadata,` full transcript text. Fires when a source is opened | #244 transcripts |
| `khqZz` | 422,615 B (byte-identical across both runs) | **Notebook hydration** — every probed source filename present, plus at least one complete audio transcript embedded | #244 (bulk path, §7) |
| `ub2Bae` | ~504 KB | **Cross-notebook enumeration** — other notebooks' titles with their sources, per-source document ids and opaque token-like strings | future batch work across many notebooks |
| `rLM1Ne` | ~86 KB (×2) | Contains source names; role not yet decoded (notebook guide / suggested questions?) | — |
| `sqTeoe`, `VfAZjd`, `ozz5Z`, `JFMDGd`, `ZwVcOc`, `hPTbtc`, `I3xc3c`, `e3bVqc`, `tr032e` | ≤3.5 KB | Small; unidentified | — |

### Envelope

```
)]}'

<decimal byte length>
[["wrb.fr","<rpcid>","<payload>",…],…]
```

`<payload>` is itself a JSON-encoded string (double parse required). An
extractor decodes: strip the `)]}'` guard + length line → `JSON.parse` →
find the `["wrb.fr", rpcid, payload]` frame → `JSON.parse(payload)`.

## 3. DOM structure (full view)

Angular + Angular Material with semantic custom elements — good news for
selector stability:

- Panels: `section.source-panel`, `section.chat-panel`, `section.studio-panel`, each containing one scrollable content div (`div.source-panel-content`, `div.chat-panel-content`, `div.panel-content-scrollable`). These three are exactly the scrollables the structural scan found.
- Conversation: `chat-message` ×20 (one per turn). Rich text renders as `labs-tailwind-structural-element-view-v2` → `paragraph-element-view`. `thinking-chain-view` ×10 (model reasoning blocks — decide keep/drop in #242).
- Opened source (transcript view): rendered inside `labs-tailwind-doc-viewer` as a large run of `paragraph-element-view` (508/489 counts vs ~191/172 in the panel view), under a "Source guide" summary block.
- Studio panel: `mat-card` ×20 covering generator tiles + artifact rows.
- aria-label counts: landing 102, full view 225, opened-source view 107.

**Stability guidance:** anchor on custom element TAGS and the semantic
`section.*-panel` classes. Never use `ng-tns-*` (per-build hash) or
`ng-star-inserted` (structural directive noise) — both change between
Google builds.

## 4. Fixture completeness signals

- iframes in every capture are boilerplate only (OneGoogle account widget, Tag Manager, `/_/bscframe`, `accounts.google.com/RotateCookiesPage`) — no content lives in them.
- Zero shadow roots in every scan → `page.content()` dumps are complete for extraction design.

## 5. Evidence (local only, gitignored)

```
data/recon/notebooks-run1/   run 1 — landing + full view (4 staged captures)
data/recon/notebooks/        run 2 — opened-source/transcript capture
  fixtures/*.html            full-page DOM dumps per stage
  screens/*.png              screenshots per stage
  network.jsonl              per-response metadata (no headers, ever)
  bodies/*.txt               xhr/fetch payloads (the RPC evidence above)
  report.json                URLs + structural scans per stage
```

Run-1 note: its `artifacts` and `transcript` stage dumps are duplicates of
neighboring stages — a tab-picker bug captured a stale tab (fixed in the
spec: focused page preferred, newest visible as fallback). Run 2 supplied
the real opened-source capture.

## 6. Recon harness usage

```
npm run test:e2e:notebook-recon
```

- Operator-paced: a banner on the page says what to arrange; Resume in the Playwright Inspector captures the stage.
- `RECON_START_URL` — start directly at a notebook URL; `RECON_STAGES` — run a subset (e.g. `transcript`); `RECON_OUT` — output root, point at a fresh dir per notebook.
- Launch retries while the profile is locked by another Chrome window.
- The harness NEVER closes the browser window — the operator always does (the run holds until then). Login persists in `~/.clio-profiles/gemini`.

## 7. Open questions for the extractor phase

1. **Artifact download endpoint** — no artifact was downloaded during recon; #243 needs one live download click to capture it.
2. **Does `khqZz` carry ALL transcripts?** One full transcript and every probed filename were found in it. If it is a full-content hydration, #244 can extract every transcript in one request without opening sources. Needs a decode of the payload, then verification against a second source's content.
3. **Landing "Past chats" store** — empty while the full view held a 20-message chat. Relationship unknown; matters only if some notebooks keep chats there.
4. **Source pagination** — 28 sources arrived in one `wXbhsf` payload; behavior at larger counts unknown.
5. **Audio file itself** — transcripts are text via `hizoJc`/`khqZz`; whether the original m4a is fetchable is undetermined (part of the #244 design discussion).

## Privacy

This repository is PUBLIC. Every raw capture (DOM dumps, screenshots,
network bodies) contains personal notebook content and/or session-bearing
URLs, and lives exclusively under gitignored `data/` — never commit it.
Sanitized jsdom fixtures are authored deliberately per extractor, never
copied wholesale from dumps. The capture harness records no request or
response headers.
