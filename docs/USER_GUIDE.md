# Clio User Guide

Clio is a Chrome extension for extracting Gemini conversations to structured JSON files with images.

## Installation

### From Chrome Web Store

*Coming soon*

### From Source (Developer Mode)

1. Download or clone the Clio repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `extension` folder inside the Clio directory
6. The Clio icon will appear in your toolbar

**Edge users:** Use `edge://extensions` instead.

## Basic Usage

### Step 1: Open a Gemini Conversation

Navigate to any Gemini conversation at `https://gemini.google.com/app/...`

### Step 2: Wait for Streaming to Complete

If Gemini is still generating a response, wait for it to finish. You'll know it's done when:
- The "Stop" button disappears
- The response text stops appearing

### Step 3: Extract the Conversation

1. Click the **Clio icon** in your Chrome toolbar
2. Click **Extract Conversation**
3. Wait for extraction to complete (progress will be shown)
4. Choose where to save the zip file

### Step 4: Review Your Export

The downloaded zip file contains:
- `conversation.json` - The full conversation transcript
- `images/` folder - All images from the conversation

## Understanding the Output

### conversation.json Structure

```json
{
  "metadata": {
    "conversationId": "abc123def456",
    "title": "Help with Python code",
    "extractedAt": "2026-01-19T15:30:00.000Z",
    "url": "https://gemini.google.com/app/abc123def456",
    "turnCount": 24,
    "imageCount": 3,
    "extractionErrors": []
  },
  "turns": [
    {
      "index": 0,
      "role": "user",
      "content": "Can you help me write a sorting algorithm?",
      "thinking": null,
      "attachments": []
    },
    {
      "index": 1,
      "role": "assistant",
      "content": "Here's a quicksort implementation:\n\n```python\ndef quicksort(arr):\n    ...\n```",
      "thinking": "The user wants a sorting algorithm...",
      "attachments": []
    }
  ]
}
```

### Field Descriptions

| Field | Description |
|-------|-------------|
| `conversationId` | Unique ID from the Gemini URL |
| `title` | Conversation title from Gemini |
| `turnCount` | Number of messages (user + assistant) |
| `imageCount` | Number of images extracted |
| `extractionErrors` | Any errors that occurred (images may fail) |
| `role` | Either "user" or "assistant" |
| `content` | Message text with code blocks preserved |
| `thinking` | Gemini's "Show thinking" content (if expanded) |
| `attachments` | Images attached to the message |

## Using the Viewer

Clio includes a standalone viewer for browsing exported conversations.

### Opening the Viewer

1. Open `viewer/viewer.html` in your browser
2. Drag and drop a `conversation.json` file onto the page
   - Or click **Browse Files** to select one

### Viewer Features

- **Sidebar**: Lists all loaded conversations
- **Bubbles**: Messages displayed in chat format
- **Compact Mode**: Long messages are truncated (click to expand)
- **Click to Copy**: Click any message to copy its content
- **Thinking Sections**: Click "Show thinking" to reveal Gemini's reasoning

## Troubleshooting

### "Please open a Gemini conversation first"

You're not on a Gemini page. Navigate to `https://gemini.google.com/app/...`

### "Failed to load JSZip"

The extension couldn't load the zip library. Try:
1. Reload the extension in `chrome://extensions`
2. Refresh the Gemini page
3. Try extraction again

### "Content script not loaded"

The extension's content script didn't inject properly. Try:
1. Refresh the Gemini page
2. If that doesn't work, reload the extension

### Extraction shows errors but still works

Clio uses "fail open" for images - if an image can't be downloaded, it logs an error but continues. Check `metadata.extractionErrors` in the JSON for details.

### Some images are missing

Cross-origin images or very large images may fail to extract. The conversation text will still be complete.

### Streaming detection issues

If Clio thinks Gemini is still streaming when it's not:
1. Wait a few seconds
2. Try extraction again

## Privacy

**All processing happens locally in your browser.**

- No data is sent to external servers
- Your conversations never leave your computer
- The extension only activates on Gemini pages

## Tips

1. **Expand "Show thinking"** before extracting if you want to capture Gemini's reasoning
2. **Wait for all images to load** on the page before extracting
3. **Large conversations** (100+ turns) may take longer to process
4. **Use the viewer** for easier reading of exported conversations

## Getting Help

- Report issues: https://github.com/martymcenroe/Clio/issues
- Check existing issues for known problems and workarounds
