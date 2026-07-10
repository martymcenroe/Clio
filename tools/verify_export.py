#!/usr/bin/env python3
"""
Verify a Clio batch-download run against an independent oracle.

Diffs each DOM-extracted conversation ZIP (what the extension produced) against
the site's data-API export (a structurally-clean second source of truth), and
reports per-conversation and corpus anomalies. This is the operational form of
the "oracle diff" verification layer (docs/testing/extraction-verification-strategy.md).

Usage:
    python tools/verify_export.py <clio-archive-dir> <oracle-dir> [--json]

    <clio-archive-dir>  folder of extension-produced ZIPs (e.g. Downloads/clio-archive)
    <oracle-dir>        folder of API-export ZIPs        (e.g. data/claude-export/zips)

Exit code is non-zero if any corpus invariant is violated.
"""
import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

CSS_LEAK = re.compile(r"@keyframes|<style\b")
REPLACEMENT = "�"


def load_zip_conversations(folder: Path) -> dict:
    """id -> normalized conversation dict, from every ZIP holding a conversation.json."""
    out = {}
    for zpath in sorted(folder.glob("*.zip")):
        try:
            with zipfile.ZipFile(zpath) as zf:
                if "conversation.json" not in zf.namelist():
                    continue
                data = json.loads(zf.read("conversation.json").decode("utf-8"))
                images = [n for n in zf.namelist() if n.startswith("images/") and not n.endswith("/")]
        except (zipfile.BadZipFile, json.JSONDecodeError, KeyError):
            continue
        meta = data.get("metadata", {})
        cid = meta.get("conversationId")
        if not cid:
            continue
        msgs = data.get("messages", [])
        out[cid] = {
            "id": cid,
            "title": meta.get("title", ""),
            "count": len(msgs),
            "roles": [m.get("role") for m in msgs],
            "texts": [(m.get("content") or m.get("text") or m.get("allText") or "") for m in msgs],
            "image_files": len(images),
        }
    return out


def analyze(dom: dict, oracle: dict) -> dict:
    """Return per-conversation findings comparing DOM extraction against the oracle."""
    full_text = "\n".join(dom["texts"])
    o = oracle.get(dom["id"])
    flags = []

    # #204 — dropped turns vs oracle
    if o is not None and dom["count"] < o["count"]:
        flags.append(f"DROPPED-TURNS(dom {dom['count']} < api {o['count']})")

    # #205 — first turn should be a user turn
    if dom["roles"] and dom["roles"][0] != "user":
        flags.append("NO-OPENING-USER")

    # #208 — blank message
    empties = sum(1 for t in dom["texts"] if not t.strip())
    if empties:
        flags.append(f"{empties}-EMPTY-MSG")

    # #206 — CSS/style leaked into content
    if CSS_LEAK.search(full_text):
        flags.append("CSS-IN-CONTENT")

    # #209 — doubled title ("X X")
    t = (dom["title"] or "").strip()
    if t and re.match(r"^(.{3,}?)\s+\1$", t):
        flags.append("DOUBLED-TITLE")

    # Unicode integrity
    if REPLACEMENT in full_text:
        flags.append("UNICODE-CORRUPTION")

    return {"id": dom["id"], "title": dom["title"], "count": dom["count"],
            "oracle_count": o["count"] if o else None, "flags": flags}


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify a Clio export against the API oracle.")
    ap.add_argument("archive_dir")
    ap.add_argument("oracle_dir")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows console is cp1252
    except AttributeError:
        pass

    dom = load_zip_conversations(Path(args.archive_dir))
    oracle = load_zip_conversations(Path(args.oracle_dir))
    if not dom:
        print(f"No conversation ZIPs found in {args.archive_dir}", file=sys.stderr)
        return 2

    findings = [analyze(c, oracle) for c in dom.values()]
    flagged = [f for f in findings if f["flags"]]

    if args.json:
        print(json.dumps({"total": len(findings), "flagged": flagged}, indent=2))
    else:
        print(f"Verifying {len(dom)} extracted conversations against {len(oracle)} oracle conversations\n")
        for f in sorted(findings, key=lambda x: (not x["flags"], x["title"])):
            mark = "  " if not f["flags"] else "!!"
            oc = f"/{f['oracle_count']}" if f["oracle_count"] is not None else ""
            print(f"  {mark}{str(f['count'])+oc:>7}msg  {', '.join(f['flags']) or 'ok':<40} {f['title'][:40]}")
        # corpus summary
        print(f"\n=== corpus ===")
        print(f"  extracted: {len(dom)}   oracle: {len(oracle)}   in-oracle-not-extracted: {len(set(oracle)-set(dom))}")
        from collections import Counter
        tally = Counter(flag.split('(')[0] for f in flagged for flag in f["flags"])
        for k, v in tally.most_common():
            print(f"  {v:>3}  {k}")

    # invariant gate: real content-loss classes fail the run
    hard = [f for f in findings if any(x.startswith(("DROPPED-TURNS", "UNICODE-CORRUPTION", "CSS-IN-CONTENT")) for x in f["flags"])]
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
