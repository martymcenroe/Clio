#!/usr/bin/env python3
"""Build dist/site/ from docs/ for Cloudflare Pages deploy.

Usage:
    python tools/build_site.py

Output:
    dist/site/ containing only the public-facing files (index.html,
    privacy.html, _redirects).

Why this script exists
----------------------
`docs/` is a mixed-content directory: it holds both the 3 public-facing
files served at cliocast.com AND ~24 internal artifacts (LLDs, runbooks,
ADRs, reports). Deploying from `docs/` directly (as the original runbook
30003 instructed) published all 31 files to Cloudflare Pages on
2026-05-23 — the project was deleted within minutes and triggered a
fleet-wide session-log audit.

Fleet rule (post-incident): never deploy from a mixed-content directory.
Always copy intended files to `dist/site/` via this script, then deploy
`dist/site/`.

The script is idempotent: it wipes `dist/site/` before each copy so a
file removed from the source list does not linger in a future deploy.
"""

from pathlib import Path
import shutil
import sys

REPO_ROOT = Path(__file__).parent.parent
SOURCE_DIR = REPO_ROOT / "docs"
DEST_DIR = REPO_ROOT / "dist" / "site"

SITE_FILES = [
    "index.html",
    "privacy.html",
    "_redirects",
]


def clean_dest(dest: Path) -> None:
    """Remove all files in the destination so removed source files don't linger."""
    if dest.exists():
        for entry in dest.iterdir():
            if entry.is_file():
                entry.unlink()
            elif entry.is_dir():
                shutil.rmtree(entry)
    else:
        dest.mkdir(parents=True)


def copy_files(source: Path, dest: Path, files: list[str]) -> int:
    """Copy each file from source to dest. Returns the count copied."""
    copied = 0
    for name in files:
        src = source / name
        if not src.exists():
            raise FileNotFoundError(f"Missing source file: {src}")
        shutil.copy2(src, dest / name)
        copied += 1
    return copied


def main() -> int:
    print("=" * 50)
    print("Building dist/site/ from docs/")
    print("=" * 50)
    print()

    try:
        print(f"Step 1: Cleaning {DEST_DIR}...")
        clean_dest(DEST_DIR)
        print(f"  [OK] {DEST_DIR} ready")

        print(f"\nStep 2: Copying {len(SITE_FILES)} files...")
        count = copy_files(SOURCE_DIR, DEST_DIR, SITE_FILES)
        for name in SITE_FILES:
            print(f"  [OK] {name}")

        print()
        print("=" * 50)
        print("Build complete!")
        print("=" * 50)
        print(f"  Output: {DEST_DIR} ({count} files)")
        print()
        print("Deploy:")
        print("  wrangler pages deploy dist/site --project-name=clio")
        return 0

    except FileNotFoundError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
