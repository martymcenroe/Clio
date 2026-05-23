#!/usr/bin/env python3
"""Build Chrome Web Store release artifact for Clio.

Usage:
    python tools/build_release.py

Output:
    dist/clio-chrome-v{version}.zip

The version is read from extensions/manifest.json and used to name the
output ZIP. The script verifies icon presence and packages the contents
of extensions/ with forward-slash paths (which is what the Chrome Web
Store reviewer expects; backslashes get rejected).

Adapted from Aletheia's build_release.py. Clio is Chrome-only — no
Firefox AMO support in this release.
"""

from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import sys

# Paths
REPO_ROOT = Path(__file__).parent.parent
EXTENSION_DIR = REPO_ROOT / "extensions"
DIST_DIR = REPO_ROOT / "dist"

# Config
ICON_SIZES = [16, 32, 48, 128]
EXCLUDE_PATTERNS = {".git", "__pycache__", ".DS_Store", "node_modules"}
EXCLUDE_SUFFIXES = {".pyc"}


def verify_icons(extension_dir: Path) -> None:
    """Verify all required icons exist and are non-empty."""
    for size in ICON_SIZES:
        icon = extension_dir / "icons" / f"icon{size}.png"
        if not icon.exists():
            raise FileNotFoundError(
                f"Missing icon: {icon}. Commit icons before building."
            )
        if icon.stat().st_size < 100:
            raise ValueError(
                f"Suspicious icon: {icon} is only {icon.stat().st_size} bytes. "
                "May be empty placeholder."
            )
    print(f"  [OK] All {len(ICON_SIZES)} icons present and non-empty")


def load_manifest(path: Path) -> dict:
    """Load and parse the manifest JSON file."""
    return json.loads(path.read_text(encoding="utf-8"))


def validate_manifest(manifest: dict) -> None:
    """Basic sanity checks on the manifest before building."""
    required_keys = ["manifest_version", "name", "version", "description"]
    missing = [k for k in required_keys if k not in manifest]
    if missing:
        raise ValueError(f"manifest.json missing required keys: {missing}")

    if manifest["manifest_version"] != 3:
        raise ValueError(
            f"Expected manifest_version 3 (Chrome Web Store requires MV3), "
            f"got {manifest['manifest_version']}"
        )

    print(f"  [OK] Manifest valid (MV3, name='{manifest['name']}')")


def should_include(path: Path) -> bool:
    """Filter out excluded patterns."""
    if any(pattern in path.parts for pattern in EXCLUDE_PATTERNS):
        return False
    if path.suffix in EXCLUDE_SUFFIXES:
        return False
    return True


def build_zip(source_dir: Path, output: Path) -> int:
    """Create a ZIP archive from a source directory.

    Returns the number of files included.
    """
    file_count = 0
    with ZipFile(output, "w", ZIP_DEFLATED) as z:
        for file in source_dir.rglob("*"):
            if not file.is_file():
                continue
            if not should_include(file):
                continue
            relative = file.relative_to(source_dir)
            # ZipFile uses forward slashes when arcname is a string
            # constructed from PosixPath-style joining
            z.write(file, arcname=str(relative).replace("\\", "/"))
            file_count += 1
    return file_count


def main() -> int:
    """CLI entry point. Returns 0 on success, 1 on error."""
    print("=" * 50)
    print("Building Clio Chrome Web Store release")
    print("=" * 50)
    print()

    try:
        # Step 1: Verify icons
        print("Step 1: Verifying icons...")
        verify_icons(EXTENSION_DIR)

        # Step 2: Load and validate manifest
        print("\nStep 2: Loading manifest...")
        manifest_path = EXTENSION_DIR / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"Missing manifest: {manifest_path}")
        manifest = load_manifest(manifest_path)
        validate_manifest(manifest)
        version = manifest["version"]
        print(f"  [OK] Version: {version}")

        # Step 3: Prepare dist directory
        print("\nStep 3: Preparing dist directory...")
        DIST_DIR.mkdir(exist_ok=True)
        print(f"  [OK] {DIST_DIR}")

        # Step 4: Build ZIP
        print("\nStep 4: Building Chrome artifact...")
        output = DIST_DIR / f"clio-chrome-v{version}.zip"
        # Remove existing artifact for the same version so we don't accidentally
        # append to an old ZIP and ship stale content
        if output.exists():
            output.unlink()
        file_count = build_zip(EXTENSION_DIR, output)
        print(f"  [OK] {output.name} ({file_count} files)")

        # Done
        print()
        print("=" * 50)
        print("Build complete!")
        print("=" * 50)
        print(f"  Artifact: {output}")
        print(f"  Size:     {output.stat().st_size:,} bytes")
        print()
        print("Verify before upload:")
        print(f"  unzip -l {output.relative_to(REPO_ROOT)}")
        print()
        print("Next steps:")
        print("  1. Confirm forward-slash paths in the listing")
        print("  2. Confirm manifest.json sits at archive root (no nested folder)")
        print("  3. Load unpacked in chrome://extensions and smoke-test")
        print("  4. Follow docs/runbooks/30002-chrome-web-store-publish.md for upload")
        return 0

    except FileNotFoundError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"\nERROR: Invalid JSON in manifest: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
