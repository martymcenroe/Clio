#!/usr/bin/env python3
"""Resize a screenshot to exactly 1280x800 PNG for the Chrome Web Store listing.

The store requires screenshots at 1280x800. This tool scales-to-width and then
crops vertically, with a configurable anchor (default: top, which preserves the
Clio popup at the top of the image and trims the chat-input bar at the bottom).

If the scaled source is shorter than 800px, the output is letterboxed with a
dark background to match Gemini/Claude/ChatGPT dark themes.

Usage:
    python tools/resize_screenshot.py <input> <output> [--anchor top|center|bottom]
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

TARGET_W = 1280
TARGET_H = 800
BG = (32, 32, 32)


def resize_for_cws(input_path: Path, output_path: Path, anchor: str = "top") -> None:
    img = Image.open(input_path).convert("RGB")
    src_w, src_h = img.size

    scale = TARGET_W / src_w
    new_w = TARGET_W
    new_h = int(round(src_h * scale))
    resized = img.resize((new_w, new_h), Image.LANCZOS)

    if new_h > TARGET_H:
        if anchor == "top":
            box = (0, 0, TARGET_W, TARGET_H)
        elif anchor == "bottom":
            box = (0, new_h - TARGET_H, TARGET_W, new_h)
        else:
            off = (new_h - TARGET_H) // 2
            box = (0, off, TARGET_W, off + TARGET_H)
        out = resized.crop(box)
    elif new_h < TARGET_H:
        out = Image.new("RGB", (TARGET_W, TARGET_H), BG)
        off_y = (TARGET_H - new_h) // 2
        out.paste(resized, (0, off_y))
    else:
        out = resized

    output_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(output_path, "PNG", optimize=True)
    print(f"{src_w}x{src_h} -> scaled {new_w}x{new_h} -> {out.size} ({anchor}-anchored) -> {output_path}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--anchor", choices=["top", "center", "bottom"], default="top")
    args = p.parse_args()
    if not args.input.exists():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1
    resize_for_cws(args.input, args.output, args.anchor)
    return 0


if __name__ == "__main__":
    sys.exit(main())
