# Clio Icon Design

## Concept

Two sparkle/star shapes (representing conversation) positioned above a Greek-style V chevron pointing downward (representing download), no overlap between elements.

## Colors

- **Stars:** Electric cyan (`#00FFFF`)
- **V chevron:** Darker cyan (`#009999`)

## Master Icon Source

**File:** `tools/master.png`
**Origin:** Nano Banana AI-generated image
**Original filename:** `Gemini_Generated_Image_d211ood211ood211.png`

## Generated Sizes

| Size | Use Case |
|------|----------|
| 16px | Browser toolbar, favicon |
| 32px | Windows taskbar |
| 48px | Extension management page |
| 128px | Chrome Web Store, installation dialog |

## Generation

Run from the Clio project root:

```bash
poetry run --directory /c/Users/mcwiz/Projects/AgentOS python /c/Users/mcwiz/Projects/Clio/tools/generate_icons.py --transparent
```

## Design Requirements

- Must be distinct and recognizable at 16x16 pixels
- Transparent background (PNG)
- Electric cyan for visibility on dark browser themes
- Simple shapes that read clearly at small sizes
