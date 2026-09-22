#!/usr/bin/env python
"""Land `.github/workflows/test.yml` via the GitHub Contents API (#366).

WHY THIS EXISTS. The repo's fine-grained PAT deliberately lacks `workflow`
scope, so `git push` refuses any commit that creates or updates a file under
`.github/workflows/`:

    ! [remote rejected] 366-test-ci -> 366-test-ci (refusing to allow a Personal
      Access Token to create or update workflow `.github/workflows/test.yml`
      without `workflow` scope)

That refusal is the design working, not a misconfiguration to fix. Widening the
PAT, swapping `gh auth` to a classic token, or reaching for `--admin` are all
wrong. The sanctioned path is the Contents API with an in-process classic PAT,
per AssemblyZero ADR-0216.

WHO RUNS THIS. **You do, not an agent.** ADR-0216's guarantee is that the
decrypted PAT lives only in this process's heap; an agent that spawns the
process is its parent and can read that heap, which dissolves the guarantee.
An agent may write this script. It may not run it.

    cd C:\\Users\\mcwiz\\Projects\\AssemblyZero
    poetry run python C:\\Users\\mcwiz\\Projects\\Clio\\tools\\land_test_workflow.py --apply

Run from AssemblyZero so poetry supplies `requests` and `_pat_session`.
Without `--apply` it prints what it would do and touches nothing.

WHAT IT DOES. Creates a branch from main, PUTs the workflow file, opens a PR
that closes #366, waits for the PR to become mergeable, and squash-merges it.
Idempotent enough to re-run if it dies partway: it reuses an existing branch or
PR rather than erroring.

The workflow content is embedded below rather than read from disk, so this
script is self-contained and does not depend on a working tree that still has
the file.
"""
from __future__ import annotations

import argparse
import base64
import sys
import time
from pathlib import Path

import requests

# _pat_session lives in AssemblyZero's tools/ alongside the ADR that defines it.
AZ_TOOLS = Path(r"C:\Users\mcwiz\Projects\AssemblyZero\tools")
if str(AZ_TOOLS) not in sys.path:
    sys.path.insert(0, str(AZ_TOOLS))

from _pat_session import classic_pat_session  # noqa: E402

GH_API = "https://api.github.com"
REPO = "martymcenroe/Clio"
BRANCH = "366-test-ci"
FILE_PATH = ".github/workflows/test.yml"
ISSUE = 366

PR_TITLE = "ci: run the unit tests and the linter on every PR (Closes #366)"

# Embedded deliberately -- see the module docstring. LF endings only: the
# Contents API stores bytes verbatim, and a CRLF payload would flip the whole
# file's line endings on origin (ADR-0216 gotcha 3).
WORKFLOW = """name: Tests

# 573 unit tests existed in this repo and none of them ran in CI (#366). The
# only workflow was Auto Review, which checks issue references -- so a PR that
# broke every test in the repo satisfied branch protection, and a test could sit
# failing in the index for two weeks without anything saying so. One did.
#
# Unit tests and lint only. `npm test` covers the jest suites; the four specs
# under tests/e2e/ and tests/viewer.e2e.test.js are Playwright, human-in-the-loop
# (page.pause(), headed Chrome, persistent login profiles) and cannot run on a
# runner. jest.config.js excludes them by the *.e2e.test.js suffix.

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - name: Install
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Unit tests
        run: npm test
"""

PR_BODY = """573 unit tests existed in this repo and none of them ran in CI.

The only workflow was Auto Review, which checks issue references. A PR that
broke every test in the repo satisfied branch protection, and a test could sit
failing in the index for two weeks without anything saying so -- one did, after
PR #340 scrubbed the fixture `tests/sidebar-enumerate.test.js` asserted against.

Unit tests and lint only. The four specs under `tests/e2e/` and
`tests/viewer.e2e.test.js` are Playwright, human-in-the-loop (`page.pause()`,
headed Chrome, persistent login profiles) and cannot run on a runner;
`jest.config.js` excludes them by the `*.e2e.test.js` suffix.

Landed through the Contents API rather than `git push`, because the
fine-grained PAT deliberately lacks `workflow` scope (AssemblyZero ADR-0216).
Script: `tools/land_test_workflow.py`.

Making this check **required** is a branch-protection change needing admin
scope, tracked separately so it is not lost.

Closes #366

parent: #357
"""


def api(pat: str, method: str, path: str, **kw) -> requests.Response:
    r = requests.request(
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
    return r


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--apply",
        action="store_true",
        help="actually create the branch, file, PR and merge (default: dry run)",
    )
    args = ap.parse_args()

    if not args.apply:
        print("DRY RUN -- nothing will be changed. Re-run with --apply.")
        print(f"  repo   {REPO}")
        print(f"  branch {BRANCH}")
        print(f"  file   {FILE_PATH}  ({len(WORKFLOW.encode())} bytes, LF)")
        print(f"  PR     {PR_TITLE}")
        print(f"  closes #{ISSUE}")
        return 0

    with classic_pat_session(reason=f"land {FILE_PATH} in {REPO} (#{ISSUE})") as pat:
        # 0. The issue must still be open, or pr-sentinel will reject the PR.
        r = api(pat, "GET", f"/repos/{REPO}/issues/{ISSUE}")
        r.raise_for_status()
        if r.json().get("state") != "open":
            print(f"ABORT: issue #{ISSUE} is not open.", file=sys.stderr)
            return 1

        # 1. Branch from main.
        r = api(pat, "GET", f"/repos/{REPO}/git/ref/heads/main")
        r.raise_for_status()
        main_sha = r.json()["object"]["sha"]

        r = api(pat, "GET", f"/repos/{REPO}/git/ref/heads/{BRANCH}")
        if r.status_code == 404:
            r = api(
                pat,
                "POST",
                f"/repos/{REPO}/git/refs",
                json={"ref": f"refs/heads/{BRANCH}", "sha": main_sha},
            )
            r.raise_for_status()
            print(f"created branch {BRANCH} at {main_sha[:7]}")
        else:
            r.raise_for_status()
            print(f"branch {BRANCH} already exists -- reusing")

        # 2. Put the workflow file on that branch.
        r = api(pat, "GET", f"/repos/{REPO}/contents/{FILE_PATH}", params={"ref": BRANCH})
        existing_sha = r.json().get("sha") if r.status_code == 200 else None

        payload = {
            "message": f"ci: run the unit tests and the linter on every PR (Closes #{ISSUE})",
            "content": base64.b64encode(WORKFLOW.encode("utf-8")).decode("ascii"),
            "branch": BRANCH,
        }
        if existing_sha:
            payload["sha"] = existing_sha
        r = api(pat, "PUT", f"/repos/{REPO}/contents/{FILE_PATH}", json=payload)
        r.raise_for_status()
        print(f"wrote {FILE_PATH}")

        # 3. PR.
        r = api(pat, "GET", f"/repos/{REPO}/pulls", params={"head": f"martymcenroe:{BRANCH}", "state": "open"})
        r.raise_for_status()
        open_prs = r.json()
        if open_prs:
            number = open_prs[0]["number"]
            print(f"PR #{number} already open -- reusing")
        else:
            r = api(
                pat,
                "POST",
                f"/repos/{REPO}/pulls",
                json={"title": PR_TITLE, "head": BRANCH, "base": "main", "body": PR_BODY},
            )
            r.raise_for_status()
            number = r.json()["number"]
            print(f"opened PR #{number}")

        # 4. Wait for mergeable. `unstable` is accepted as well as `clean`:
        #    this PR ADDS a check, so the new check's own first run can leave
        #    the PR unstable forever from a strict-clean poller's point of view
        #    (ADR-0216 gotcha 4).
        for attempt in range(30):
            r = api(pat, "GET", f"/repos/{REPO}/pulls/{number}")
            r.raise_for_status()
            state = r.json().get("mergeable_state")
            if state in ("clean", "unstable"):
                print(f"mergeable_state={state}")
                break
            print(f"  [{attempt + 1}/30] mergeable_state={state}")
            time.sleep(10)
        else:
            print("TIMEOUT: PR never became mergeable. Leaving it open.", file=sys.stderr)
            print(f"  https://github.com/{REPO}/pull/{number}", file=sys.stderr)
            return 1

        # 5. Squash merge.
        r = api(pat, "PUT", f"/repos/{REPO}/pulls/{number}/merge", json={"merge_method": "squash"})
        r.raise_for_status()
        print(f"merged PR #{number}")

        # 6. Verify main actually moved before saying so.
        r = api(pat, "GET", f"/repos/{REPO}/git/ref/heads/main")
        r.raise_for_status()
        new_main = r.json()["object"]["sha"]
        if new_main == main_sha:
            print("ABORT: main did not move. Do not clean up.", file=sys.stderr)
            return 1
        print(f"main {main_sha[:7]} -> {new_main[:7]}")

        # 7. Remote branch is disposable now; the commit is on main.
        api(pat, "DELETE", f"/repos/{REPO}/git/refs/heads/{BRANCH}")
        print(f"deleted remote branch {BRANCH}")

    print("\nDone. Pull main, then check the new Tests workflow on the next PR.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
