#!/usr/bin/env python3
"""
Fix Nano Banana checkerboard pattern by converting it to true transparency.

The checkerboard pattern consists of alternating white (#FFFFFF) and light gray
(#C0C0C0 or similar) pixels that should be transparent.
"""

from PIL import Image
import os
import sys

def remove_checkerboard(img):
    """
    Remove checkerboard pattern and make it transparent.

    Strategy: Any pixel that's very light (close to white or light gray)
    and not part of the actual icon (cyan colors) should be transparent.
    """
    # Convert to RGBA if not already
    img = img.convert('RGBA')
    pixels = img.load()
    width, height = img.size

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]

            # Skip already transparent pixels
            if a == 0:
                continue

            # The icon uses cyan colors:
            # - Electric cyan: #00FFFF (0, 255, 255)
            # - Darker cyan/teal: #009999 (0, 153, 153) or similar
            #
            # The checkerboard uses:
            # - White: #FFFFFF (255, 255, 255)
            # - Light gray: #C0C0C0 (192, 192, 192) or similar
            #
            # Key insight: The icon pixels have HIGH green and blue, LOW red
            # The checkerboard pixels have HIGH red (near white/gray)

            # If the pixel is grayish (R≈G≈B) and light, it's checkerboard
            is_gray = abs(r - g) < 30 and abs(g - b) < 30 and abs(r - b) < 30
            is_light = r > 150 and g > 150 and b > 150

            if is_gray and is_light:
                # Make transparent
                pixels[x, y] = (0, 0, 0, 0)

    return img


def process_icon(input_path, output_path):
    """Process a single icon file."""
    print(f"Processing: {input_path}")
    img = Image.open(input_path)
    img = remove_checkerboard(img)
    img.save(output_path, 'PNG')
    print(f"  Saved: {output_path}")


def main():
    # Get the icons directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    icons_dir = os.path.join(project_root, 'extensions', 'icons')

    # Process all icon files
    icon_files = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']

    for icon_file in icon_files:
        input_path = os.path.join(icons_dir, icon_file)
        if os.path.exists(input_path):
            process_icon(input_path, input_path)  # Overwrite in place
        else:
            print(f"  Warning: {input_path} not found")

    # Also process master.png if it exists
    master_path = os.path.join(script_dir, 'master.png')
    if os.path.exists(master_path):
        process_icon(master_path, master_path)

    print("\nDone! Reload the extension in Chrome to see the fix.")


if __name__ == '__main__':
    main()
