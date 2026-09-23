#!/usr/bin/env python
"""Make the `test` status check required on main (#376).

WHY THIS EXISTS. The Tests workflow (#366) runs on every PR and its result is
visible. Visible is not blocking. Branch protection on main currently requires
an approving review and `issue-reference`; a PR whose test job is red satisfies
both and merges anyway.

Reading branch protection with the repo's fine-grained PAT returns 403:

    Resource not accessible by personal access token (HTTP 403)

The PAT deliberately lacks `administration` scope. Same situation as the
workflow file in #366, same remedy: an in-process classic PAT per
AssemblyZero ADR-0216.

WHO RUNS THIS. **You do, not an agent.** ADR-0216's guarantee is that the
decrypted PAT lives only in this process's heap; an agent that spawns the
process is its parent and can read that heap. An agent may write this script
and may run it WITHOUT --apply, which never decrypts anything. It may not run
--apply.

    cd ~/Projects/AssemblyZero
    poetry run python ../Clio/tools/require_test_check.py --apply

Run from AssemblyZero so poetry supplies `requests` and `_pat_session`. Paths
are relative and forward-slashed on purpose: a Windows path pasted into Git
Bash loses every backslash, which is how the #366 invocation failed the first
time.

PREREQUISITE, AND IT IS NOT OPTIONAL. GitHub will not let you require a context
it has never seen, and requiring a name that never reports blocks every open PR
until someone with admin scope removes it. `test` has reported green twice --
once on PR #381 and once on the push to main -- so the name is known-good. This
script re-checks that before writing, and refuses if it cannot find a recent
successful run.

BLAST RADIUS. Additive only. It POSTs to
`/branches/main/protection/required_status_checks/contexts`, which APPENDS a
context and touches nothing else -- not the review requirement, not
enforce_admins, not the other two checks. The whole-object PUT endpoint is
deliberately not used: it requires sending every protection setting back, and
anything omitted is silently cleared.

ROLLBACK. One command, the same endpoint with DELETE:

    poetry run python ../Clio/tools/require_test_check.py --remove --apply

VERIFICATION. The script re-reads the contexts after writing and prints them.
That proves the setting landed. It does NOT prove the gate bites -- for that,
open a PR with a deliberately failing test and confirm the merge button is
blocked rather than merely decorated. A context registered under a slightly
wrong name looks identical to a working one until the day it matters.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import requests

AZ_TOOLS = Path(r"C:\Users\mcwiz\Projects\AssemblyZero\tools")
if str(AZ_TOOLS) not in sys.path:
    sys.path.insert(0, str(AZ_TOOLS))

from _pat_session import classic_pat_session  # noqa: E402

GH_API = "https://api.github.com"
REPO = "martymcenroe/Clio"
BRANCH = "main"
CONTEXT = "test"
WORKFLOW = "Tests"
ISSUE = 376

CONTEXTS_URL = f"/repos/{REPO}/branches/{BRANCH}/protection/required_status_checks/contexts"


def api(pat: str, method: str, path: str, **kw) -> requests.Response:
    return requests.request(
        method,
        f"{GH_API}{path}",
        headers={
            "Authorization": f"token {pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=30,
        **kw,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="actually change branch protection (default: dry run)")
    ap.add_argument("--remove", action="store_true", help="rollback: drop the context instead of adding it")
    args = ap.parse_args()

    verb = "REMOVE" if args.remove else "ADD"

    if not args.apply:
        print("DRY RUN -- nothing will be changed. Re-run with --apply.")
        print(f"  repo     {REPO}")
        print(f"  branch   {BRANCH}")
        print(f"  action   {verb} required status check {CONTEXT!r}")
        print(f"  endpoint {CONTEXTS_URL}")
        print(f"  issue    #{ISSUE}")
        print("\nAdditive endpoint: other protection settings are not touched.")
        return 0

    with classic_pat_session(reason=f"{verb} required check {CONTEXT!r} on {REPO}@{BRANCH} (#{ISSUE})") as pat:
        r = api(pat, "GET", CONTEXTS_URL)
        if r.status_code == 403:
            print("ABORT: this token also lacks admin on branch protection.", file=sys.stderr)
            return 1
        r.raise_for_status()
        before = sorted(r.json())
        print(f"before: {before}")

        if args.remove:
            if CONTEXT not in before:
                print(f"{CONTEXT!r} is not required; nothing to do.")
                return 0
            r = api(pat, "DELETE", CONTEXTS_URL, json=[CONTEXT])
        else:
            if CONTEXT in before:
                print(f"{CONTEXT!r} is already required; nothing to do.")
                return 0

            # GitHub will accept a context it has never seen and then block every
            # PR forever. Confirm the name is one that actually reports.
            runs = api(pat, "GET", f"/repos/{REPO}/actions/runs", params={"per_page": 20})
            runs.raise_for_status()
            seen = any(
                run.get("name") == WORKFLOW and run.get("conclusion") == "success"
                for run in runs.json().get("workflow_runs", [])
            )
            if not seen:
                print(
                    f"ABORT: no recent successful {WORKFLOW!r} run found. Requiring a context "
                    "that has never reported blocks every open PR.",
                    file=sys.stderr,
                )
                return 1

            r = api(pat, "POST", CONTEXTS_URL, json=[CONTEXT])

        r.raise_for_status()

        r = api(pat, "GET", CONTEXTS_URL)
        r.raise_for_status()
        after = sorted(r.json())
        print(f"after:  {after}")

        expected_present = not args.remove
        if (CONTEXT in after) is not expected_present:
            print(f"ABORT: {CONTEXT!r} did not {verb.lower()} as expected.", file=sys.stderr)
            return 1

        lost = set(before) - set(after) - ({CONTEXT} if args.remove else set())
        if lost:
            print(f"WARNING: contexts disappeared that should not have: {sorted(lost)}", file=sys.stderr)
            return 1

    print(
        f"\nDone. Now open a PR with a deliberately failing test and confirm the merge is "
        f"BLOCKED, not merely decorated -- that is the only thing that proves the gate bites."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
