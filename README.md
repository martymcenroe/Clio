# Clio

A Chrome extension for extracting full Gemini, Claude, and ChatGPT conversations to structured JSON with images.

**Clio** - Named after the Greek Muse of History.

## Features

- Extracts all user inputs and assistant responses in DOM order
- Supports Gemini (`gemini.google.com`), Claude (`claude.ai`), and ChatGPT (`chatgpt.com`)
- Preserves code blocks with language labels
- Captures images (screenshots, generated images)
- Includes thinking / reasoning sections when present
- Handles large conversations (100+ turns) with batched processing
- **Fail Open for images**: logs errors but continues extraction

## Installation

### From Source (Developer Mode)

1. Clone this repository
2. Run `npm install`
3. Open `chrome://extensions` (or `edge://extensions`)
4. Enable "Developer mode"
5. Click "Load unpacked"
6. Select the `extensions/` folder

### From Chrome Web Store

*Coming soon*

## Usage

1. Navigate to a supported conversation:
   - Gemini: `https://gemini.google.com/app/...`
   - Claude: `https://claude.ai/chat/...`
   - ChatGPT: `https://chatgpt.com/c/...`
2. Wait for any streaming response to complete
3. Click the Clio extension icon in the toolbar
4. Click "Extract Conversation"
5. Save the downloaded zip file

While the page shows a reply being generated, "Extract Conversation" refuses. A
page can stay that way for good (a conversation at its length limit, stuck
"thinking"), so the refusal offers **Extract anyway**, which saves what is on the
page and marks the export incomplete (`extractedWhileGenerating`).

See the [User Guide](docs/USER_GUIDE.md) for detailed instructions and troubleshooting.

## Output Format

The extension creates a zip file containing:

- `conversation.json` - Full transcript with metadata
- `images/` folder - All extracted images

### JSON Structure

```json
{
  "metadata": {
    "conversationId": "abc123",
    "title": "My Conversation",
    "extractedAt": "2026-01-19T12:34:56.789Z",
    "url": "https://chatgpt.com/c/abc123",
    "clioVersion": "1.9.10",
    "extractedWhileGenerating": false,
    "messageCount": 24,
    "imageCount": 3,
    "imagesOffered": 3,
    "fileCount": 1,
    "decorationSkipped": 12,
    "reasoningAffordances": 0,
    "reasoningCaptured": 0,
    "contentComplete": true,
    "incompleteReasons": [],
    "extractionErrors": [],
    "mediaErrors": [],
    "partialSuccess": false,
    "scrollInfo": {
      "messagesLoaded": 24,
      "scrollAttempts": 31,
      "reachedTop": true,
      "terminationReason": "reached-top",
      "finalScrollTop": 0,
      "finalScrollHeight": 48210,
      "quietRoundsAtTop": 6
    },
    "orderInfo": {
      "orderedBy": "distance from the scroller bottom, measured at capture time",
      "capturedMessages": 24,
      "withOrderKey": 24,
      "withoutOrderKey": 0,
      "neverMeasuredOnSettledDom": 0,
      "orderConfidence": "every message was ordered from a settled measurement"
    }
  },
  "messages": [
    {
      "id": "abc-123",
      "index": 0,
      "role": "user",
      "content": "Hello, can you help me with...",
      "thinking": null,
      "attachments": []
    },
    {
      "id": "def-456",
      "index": 1,
      "role": "assistant",
      "content": "Of course! Here is how...",
      "thinking": "Let me analyze this request...",
      "modelSlug": "gpt-5",
      "attachments": [
        { "type": "image", "filename": "images/001.png", "originalSrc": "..." }
      ]
    }
  ]
}
```

`orderInfo` appears only on sites whose export is ordered from the scroll capture
cache — ChatGPT, and Claude since its transcript began virtualizing. Gemini reads
turns from the live DOM, so the cache's ordering confidence would say nothing
about its exports and the key is omitted rather than reported as meaningless
zeros.

### Reading the metadata

Several fields answer "can I trust this file", and they answer different
questions.

| field | what it means |
|---|---|
| `contentComplete` | **The field to gate on.** Did the capture get the whole conversation? `incompleteReasons` says why not, in words, and is empty exactly when this is `true`. |
| `extractionErrors` | Things that cost conversation content. A human would act on these. |
| `mediaErrors` | Image fetches that failed. *Fail Open by design* — the transcript is unaffected — so these are reported and do **not** make the capture incomplete. |
| `partialSuccess` | Retained for existing consumers. It is the negation of `contentComplete` and nothing else. |
| `imagesOffered` | Conversation images the page rendered, counted by scanning each exchange rather than through the message selectors, so an image those selectors miss is still counted. Every offered image is in the ZIP (`imageCount`), in `mediaErrors`, or named in `incompleteReasons` — a missed image makes the capture incomplete. Absent where the site has no image scope defined yet, rather than a zero nobody measured. |
| `imagesReduced` | Of the images captured, how many are the site's own reduced copy rather than the original: Claude's preview of an upload seen after a page load, or Gemini's display-size copy of a generated image when the full size could not be fetched. Each is marked on its attachment (`attachments[].rendition`: `"preview"` or `"display"`) and the count is named in `incompleteReasons`. Present on the sites that have a rule for telling (Claude, Gemini). |
| `clioVersion` | The version of the extension that made the export, from its manifest. `null` when the extraction ran outside the extension (the injected tools in `tools/`), so such a capture cannot pass for a real one. |
| `extractedWhileGenerating` | `true` when the page showed a reply being generated and the export was taken with **Extract anyway**. The last reply may be partial or missing, so this sets `contentComplete: false` and is named in `incompleteReasons`. `false` on every other export. |
| `decorationSkipped` | Citation favicons deliberately not fetched. Not a failure; recorded so the drop stays auditable. |
| `reasoningAffordances` | Assistant turns that visibly offer reasoning ("Worked for 5m 34s" and similar). Reported even when zero, so "there was none to capture" stays distinguishable from "we captured all of it". |
| `reasoningCaptured` | Messages whose `thinking` is non-empty. When it is below `reasoningAffordances`, the shortfall is named in `incompleteReasons` and the capture is not complete. |
| `scrollInfo.reachedTop` | Whether the walk reached the beginning of the conversation. A capture that stopped short sets `contentComplete: false` and names the gap. |
| `scrollInfo.reachedBottom` | On sites whose transcript virtualizes, the walk first goes down from wherever the page was to the newest message, because nothing below the starting point is rendered until scrolled to. Whether it got there; `false` makes the capture incomplete. Absent where no such walk is needed. |
| `orderInfo.neverMeasuredOnSettledDom` | Messages positioned from a measurement taken before the page settled. Each one is marked `orderFromUnsettledMeasurement` in `messages`. |
| `messages[].id` | The site's own message identity. `index` is a position within *this* capture and shifts whenever the capture does; `id` does not, so two captures of one conversation can be compared exactly. `null` on sites that expose no such attribute — present-and-null, never absent, so "this site has no identity" is distinguishable from "this build is old". |

`scrollInfo.reachedTop` is a patience-bounded claim rather than a proof: the site
can always pause longer than the extension waits. `finalScrollHeight` and
`quietRoundsAtTop` record the evidence behind it, so it can be weighed instead of
taken on trust.

## Development

### Prerequisites

- Node.js 18+
- Python 3.10+ with Poetry (for icon generation)

### Running Tests

```bash
npm install
npm test                # Unit tests
npm run test:coverage   # Unit tests with coverage
npm run test:e2e        # E2E tests (Playwright)
npm run test:all        # All tests
```

See the [development runbook](docs/runbooks/30001-development-runbook.md) for detailed development instructions, including how to reload the extension after code changes.

Before opening a pull request, please read [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Privacy

All data processing happens locally in your browser. No data is sent to any external servers. See [PRIVACY.md](PRIVACY.md) for the full policy, and [SECURITY.md](SECURITY.md) for the threat model and vulnerability-reporting channel.

## License

See [LICENSE](LICENSE).
