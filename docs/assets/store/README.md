# Chrome Web Store listing assets

Drop the assets the CWS submission form needs here. The listing copy that
references these is in `docs/runbooks/30002-chrome-web-store-publish.md`
§7 / §8 / §9 (paste-ready blocks).

## Required

- **At least one screenshot** at exactly 1280x800 PNG, named
  `screenshot-1.png`. CWS rejects submissions without one.

## Recommended

- **Up to five screenshots**, one per supported site is ideal:
  `screenshot-1-claude.png`
  `screenshot-2-gemini.png`
  `screenshot-3-chatgpt.png`

  All 1280x800 PNG. Show the Clio popup open over a real conversation
  with the extract button visible — the reviewer needs to see what the
  user sees.

## Optional

- **Promo tile** at 440x280 PNG named `promo-tile.png`. Only matters
  for featured-listing eligibility. Skip for v1.0.

## How to capture a screenshot

1. Load Clio in Chrome: `chrome://extensions` → enable Developer mode
   → "Load unpacked" → select `extensions/` from this repo
2. Open any conversation on claude.ai / gemini.google.com / chatgpt.com
3. Click the Clio icon in the toolbar so the popup is visible
4. Use Chrome DevTools → Cmd/Ctrl+Shift+P → "Capture full size
   screenshot" — or a regular OS screenshot tool, cropped to 1280x800.
5. Save as PNG to this directory.

## What NOT to capture

- Conversations with sensitive content. Use a throwaway or
  Claude/ChatGPT canned-demo conversation.
- Personally-identifiable information visible in the sidebar.
- Other Chrome extensions visible in the toolbar that you don't want
  attributed to the reviewer's first impression.
