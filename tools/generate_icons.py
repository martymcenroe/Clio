#!/usr/bin/env python3
"""
Generate Chrome Extension icons from a master image.

Usage:
    poetry run python tools/generate_icons.py [OPTIONS]

Options:
    --transparent       Make background transparent (default: keep original)
    --threshold N       Darkness threshold for transparency (default: 250, range: 0-765)
    --help              Show this help message

Examples:
    # Keep original background
    poetry run python tools/generate_icons.py

    # Transparent background with default threshold
    poetry run python tools/generate_icons.py --transparent

    # Transparent with custom threshold (higher = more aggressive)
    poetry run python tools/generate_icons.py --transparent --threshold 100
"""

import os
import sys
from PIL import Image

# --- CONFIGURATION ---
SOURCE_FILENAME = "master.png"
OUTPUT_DIR = "../extension/icons"
SIZES = [16, 32, 48, 128]
DEFAULT_THRESHOLD = 250


def make_transparent(img, threshold):
    """Replace near-black pixels with transparency."""
    img = img.convert("RGBA")
    pixels = img.load()

    width, height = img.size
    converted = 0

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if (r + g + b) < threshold:
                pixels[x, y] = (0, 0, 0, 0)
                converted += 1

    return img, converted


def print_help():
    print(__doc__)
    sys.exit(0)


def parse_args():
    """Simple argument parser."""
    args = {
        "transparent": False,
        "threshold": DEFAULT_THRESHOLD,
    }

    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]

        if arg == "--help" or arg == "-h":
            print_help()
        elif arg == "--transparent":
            args["transparent"] = True
        elif arg == "--threshold":
            if i + 1 >= len(sys.argv):
                print("Error: --threshold requires a value")
                sys.exit(1)
            try:
                args["threshold"] = int(sys.argv[i + 1])
                i += 1
            except ValueError:
                print(f"Error: Invalid threshold value: {sys.argv[i + 1]}")
                sys.exit(1)
        else:
            print(f"Unknown option: {arg}")
            print("Use --help for usage information")
            sys.exit(1)

        i += 1

    return args


def generate_icons():
    """Generate icons from master image."""
    args = parse_args()

    # Locate source
    script_dir = os.path.dirname(os.path.abspath(__file__))
    source_path = os.path.join(script_dir, SOURCE_FILENAME)

    if not os.path.exists(source_path):
        print(f"Error: Could not find source image at: {source_path}")
        print(f"Please place '{SOURCE_FILENAME}' in the tools/ folder.")
        sys.exit(1)

    # Prepare output directory
    output_abs_path = os.path.join(script_dir, OUTPUT_DIR)
    if not os.path.exists(output_abs_path):
        try:
            os.makedirs(output_abs_path)
            print(f"Created directory: {output_abs_path}")
        except OSError as e:
            print(f"Error creating directory {output_abs_path}: {e}")
            sys.exit(1)

    # Process image
    try:
        with Image.open(source_path) as img:
            width, height = img.size
            print(f"Loaded '{SOURCE_FILENAME}' ({width}x{height} pixels)")

            # Auto-crop to center square
            if width != height:
                min_dim = min(width, height)
                left = (width - min_dim) // 2
                top = (height - min_dim) // 2
                right = (width + min_dim) // 2
                bottom = (height + min_dim) // 2

                img = img.crop((left, top, right, bottom))
                print(f"  [OK] Auto-cropped to center square: {min_dim}x{min_dim}")

            # Make transparent if requested
            if args["transparent"]:
                img, converted = make_transparent(img, args["threshold"])
                print(f"  [OK] Made background transparent (threshold: {args['threshold']}, {converted} pixels)")
            else:
                img = img.convert("RGBA")
                print("  [OK] Keeping original background")

            # Resize and save
            for size in SIZES:
                resized_img = img.resize((size, size), Image.Resampling.LANCZOS)

                output_filename = f"icon{size}.png"
                full_output_path = os.path.join(output_abs_path, output_filename)

                resized_img.save(full_output_path, "PNG")
                print(f"  [OK] Generated: {output_filename}")

            print(f"\nSuccess! All icons saved to: {output_abs_path}")

    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        sys.exit(1)


if __name__ == "__main__":
    generate_icons()
