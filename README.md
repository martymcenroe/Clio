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
    "url": "https://gemini.google.com/app/abc123",
    "turnCount": 24,
    "imageCount": 3,
    "extractionErrors": [],
    "partialSuccess": false
  },
  "turns": [
    {
      "index": 0,
      "role": "user",
      "content": "Hello, can you help me with...",
      "thinking": null,
      "attachments": []
    },
    {
      "index": 1,
      "role": "assistant",
      "content": "Of course! Here's how...\n\n```python\nprint('hello')\n```",
      "thinking": "Let me analyze this request...",
      "attachments": [
        { "type": "image", "filename": "images/001.png", "originalSrc": "..." }
      ]
    }
  ]
}
```

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
