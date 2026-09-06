# ChatGPT extraction tooling

Live-DOM tools for diagnosing and verifying ChatGPT extraction. They drive a
real browser over CDP; nothing here runs in CI.

**They exist because fixtures lie.** `tests/fixtures/chatgpt-conversation.html`
carries `<code data-language="python">`, which the live site does not produce
anywhere — so a fix designed against it passes its tests and ships broken. Twice
the source pointed the wrong way and only a live probe caught it:

- the real scroll container is an **ancestor** of `<main>`, not a descendant
  (#255);
- the code-block label was unreachable because `closest('pre')` stops at the
  inner CodeMirror `<pre>`, so the search **scope** was wrong rather than the
  selector (#263).

## Two things that will waste an hour if you don't know them

**`channel: 'chrome'` is required.** The profiles under `~/.clio-profiles/` are
written by real Chrome. Playwright's bundled chromium is an older build and
refuses a newer profile, aborting immediately after printing
`DevTools listening` — which looks exactly like a profile lock and is not.

**`--remote-debugging-port` is mandatory on any headed launch.** Without it
Playwright drives Chrome over a pipe, no `DevToolsActivePort` exists, and there
is no way back into that window for the rest of its life. With it,
`chromium.connectOverCDP('http://127.0.0.1:9333')` reattaches with no operator
action at all.

None of these scripts ever close a browser. The operator owns those windows.

## Environment

| variable | meaning |
|---|---|
| `CLIO_URL` | the conversation to work on (`https://chatgpt.com/c/<id>`) |
| `CLIO_FIRST` | a distinctive phrase from the conversation's **first** message — how a scroll-back knows it has reached the beginning, and how `verify-order.js` checks the transcript opens correctly |
| `CLIO_RUN` | output subdirectory under `~/Projects/clio-harvest/` (default `chatgpt-run`) |
| `CLIO_PROFILE` | Chrome profile directory (default `~/.clio-profiles/chatgpt`) |
| `CLIO_PORT` | CDP port (default 9333) |

**Output goes to `~/Projects/clio-harvest/`, never into this repo.** Extracted
conversations are operator content and Clio is public (#250).

## The scripts

| script | what it does |
|---|---|
| `harvest.js` | the working harvester: bottom-anchored ordering, settled-DOM re-measurement, per-round download clicking, patience-based scroll loop. Attaches over CDP. |
| `verify-order.js` | ordering oracle built from ChatGPT's own response numbering (`92A.`, `143E.`). Exits 1 on any inversion. Independent of every signal the scraper uses, which is the whole point — it caught a scrambled file that a message count and a turn-continuity check both passed. |
| `verify-live.js` | injects the real `extensions/src/content.js` into the live page and measures ordering, language coverage and file capture. The closest thing to an end-to-end test that actually runs. |
| `probe-ab.js` | A/B a fix against the live DOM — the form that proved the #263 scope claim (0 headers found the old way, 4 the new way). Copy it when you need to prove a change did something. |
| `probe-codeblocks.js` | code-block structure: nesting, headers, what the selector matches |
| `probe-unlabelled.js` | dumps what unlabelled blocks actually contain, so "coverage is low" can be checked against whether there was anything to find |
| `probe-order.js` | DOM order vs visual order, turn-id ranges |
| `probe-files.js` | uploaded-file card structure |
| `probe-artifacts.js` | download affordances and canvas elements |
| `inspect-codeblocks.js` | offline: language coverage and truncation tells in a harvested `conversation.json` |
| `e2e-real-extension.js` | loads the packed extension and triggers a real extraction. **Does not currently work:** Chrome 137+ removed `--load-extension`, and Chrome 152 exits immediately on `--enable-unsafe-extension-debugging`. Kept because the finding is worth not rediscovering; a working version needs a supported load path. |

## Injecting content.js into a live page

ChatGPT's CSP blocks `page.addScriptTag` (`script-src-elem` with a nonce). An
indirect eval driven over CDP is not blocked — `Runtime.evaluate` is not subject
to page CSP, and `(0, eval)(src)` runs in global scope so the file's top-level
function declarations land on `window` the way a content script leaves them.
Stub `chrome.runtime.onMessage.addListener` first or `content.js` throws on load.
`verify-live.js` does all of this.

## Note

Each `selectors-*.js` assigns `window.SELECTORS` on load. Load exactly one, or
whichever loads last silently becomes the global.
