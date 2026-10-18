# Real-extension tooling

Tools that exercise Clio **as the extension**, not as code injected into a page
(#308). Everything under `tools/chatgpt/` injects `content.js` into the page's
main world, which tests the extraction logic but not the shipped artefact: a
content script runs in an isolated world with the extension's
`host_permissions`, and the delivery path (message passing, the base64 hop,
JSZip, the download) only runs in the real extension.

## Setup, once per profile

1. `node tools/chatgpt/open-session.js` opens Chrome with the debugging port.
   Which node and which Chrome depends on the side you are on; see
   `tools/chatgpt/README.md`, "Windows or Ubuntu".
2. In that window: `chrome://extensions`, Developer mode, **Load unpacked**,
   the repository's `extensions/` folder. Chrome 137+ ignores
   `--load-extension`, so this one step is manual; the profile keeps it.
3. Sign in to the sites to be tested, in the same window.
4. Keep a `chrome://extensions` tab open: the harness reads the extension's id
   from it (or set `CLIO_EXT_ID`).

## The tools

| script | what it does |
|---|---|
| `capture-via-popup.js` | opens the extension's popup page in a small window of its own, clicks Extract, and saves the ZIP the popup built, byte for byte. Two seams only: "the active tab" resolves to the target conversation, and the download hands over the blob instead of raising Save As. Everything between is the shipped code. `CLIO_TARGET` (URL fragment), `CLIO_OUT` (outside this repo). |
| `inspect-zip.js` | what a ZIP actually holds: messages and roles, the export's metadata, every image file with its size and its format read from its magic bytes, and whether each image attachment resolves to a decodable file. |
| `compare-with-injected.js` | runs an injected capture on the same tab and compares it with a ZIP, by message id: roles, text lengths, image attachments, fetch outcomes. Says whether the injected probes are a valid stand-in. |
| `make-test-images.js` | writes synthetic PNG test patterns to upload, so image tests never need a real photo. |

**Output never goes into this repository.** Clio is public and a capture is a
whole conversation (#250). The scripts refuse a destination inside the repo.
The default home is `clio-harvest/` beside the repo.

None of these close a window or a tab. The operator owns the browser.
