# Runbook: Clio Conversation Viewer

## Overview

The Clio Viewer is a browser-based tool for browsing harvested Gemini conversations. It runs entirely client-side with no external dependencies.

## Quick Start

1. Open `viewer/viewer.html` in any modern browser (Chrome, Firefox, Edge)
2. Drag-and-drop JSON conversation files onto the window, or click "Browse Files"
3. Click a conversation in the sidebar to view it
4. Click any message bubble to copy its content to clipboard

## File Location

```
Clio/
└── viewer/
    ├── viewer.html           <- Open this file in browser
    ├── viewer.template.html  <- Source template (do not edit viewer.html directly)
    ├── viewer-logic.js       <- Logic module (unit tested)
    └── build.js              <- Build script
```

### Building

If you modify `viewer-logic.js` or `viewer.template.html`, regenerate `viewer.html`:

```bash
npm run build:viewer
```

## Features

### Loading Conversations

| Method | How |
|--------|-----|
| Drag & Drop | Drag JSON files anywhere on the page |
| File Picker | Click "Browse Files" button in header |
| Multiple Files | Select/drag multiple files at once |

**Supported formats:** `.json` files exported by Clio extension

**File limits:**
- Warning at 5MB
- Rejected at 20MB (prevents browser freeze)

### Viewing Conversations

| Element | Description |
|---------|-------------|
| Sidebar | Lists all loaded conversations by title |
| Blue bubbles | Your messages (right-aligned) |
| Gray bubbles | Gemini responses (left-aligned) |
| Thinking sections | Expandable "Show thinking" in assistant messages |

### Compact Mode (Default)

- Each bubble shows max 5 lines with fade gradient
- Click "Show more" to expand individual bubbles
- Click "Compact Mode" button to toggle all bubbles

### Copy to Clipboard

- **Click any bubble** to copy its full content
- Visual flash confirms copy
- Toast notification appears
- Copies raw text (preserves markdown/code)

## Troubleshooting

### File won't load

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Only .json files supported" | Wrong file type | Use `.json` files only (ZIP support planned for Phase 2) |
| "Missing or invalid metadata" | Corrupted/incomplete export | Re-export conversation with Clio extension |
| "File exceeds 20MB limit" | File too large | Split conversation or contact maintainer |
| "Turn X: invalid role" | Malformed conversation data | Check JSON structure matches expected format |

### Nothing appears after loading

1. Check browser console (F12) for errors
2. Verify JSON file is valid: `JSON.parse(fileContent)` should not throw
3. Ensure file has `metadata` object and `turns` array

### Copy doesn't work

- **Cause:** Browser clipboard permissions denied
- **Fix:** Click "Allow" when browser prompts for clipboard access
- **Alternative:** Use Ctrl+C after clicking bubble (text is selected)

## Expected JSON Format

```json
{
  "metadata": {
    "conversationId": "abc123",
    "title": "My Conversation",
    "extractedAt": "2026-01-19T12:00:00.000Z",
    "turnCount": 4
  },
  "turns": [
    {
      "index": 0,
      "role": "user",
      "content": "Message text...",
      "thinking": null,
      "attachments": []
    },
    {
      "index": 1,
      "role": "assistant",
      "content": "Response text...",
      "thinking": "Optional thinking content...",
      "attachments": []
    }
  ]
}
```

## Privacy

**All data stays local.** The viewer:
- Runs entirely in your browser
- Makes zero network requests
- Stores nothing persistently
- Closes when you close the tab

## Testing the Viewer

```bash
# Unit tests
npm test

# E2E tests (requires Playwright)
npm run test:e2e

# All tests
npm run test:all
```

## Related Documents

- [LLD: Conversation Viewer](../reports/1/lld-conversation-viewer.md)
- [Issue #1](https://github.com/martymcenroe/Clio/issues/1)
