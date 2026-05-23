# 30003 — Cloudflare Pages setup for cliocast.com

## Purpose

Stand up `cliocast.com` on Cloudflare Pages, serving from this repo's `docs/` folder. After this runbook completes, the URL pasted into the Chrome Web Store listing's *Privacy Policy URL* field will resolve, the rest of the public-facing artifacts (privacy page, landing page, redirects to GitHub) will be live, and the GitHub repo's `homepage` will point at the live site.

This is a one-time setup. After the initial wiring, every push to `main` triggers an automatic redeploy through the Cloudflare ↔ GitHub integration.

---

## Prerequisites

- [ ] `wrangler` CLI installed and authenticated against the publisher's Cloudflare account (`mcwizard1@gmail.com`, the same account `aletheia-api` runs in). Verify: `wrangler whoami` shows the right email.
- [ ] `cliocast.com` already registered and on Cloudflare DNS (per the publisher's records — domain is already there).
- [ ] Classic PAT already gpg-encrypted at `~/.secrets/classic-pat.gpg` (per `AssemblyZero/docs/adrs/0216-in-process-classic-pat-decryption.md`). Verify: `ls ~/.secrets/classic-pat.gpg`.
- [ ] gpg-agent configured with `default-cache-ttl 0` and `max-cache-ttl 0` in `~/.gnupg/gpg-agent.conf` (so sibling-process silent decrypts cannot occur).
- [ ] `docs/index.html` and `docs/_redirects` already exist on `main` (landed in PR #106).

---

## Two paths

You have two viable approaches. Pick one and stick with it; mixing creates confusing state.

### Path A — Cloudflare Pages GitHub integration (recommended)

Cloudflare connects to the GitHub repo via OAuth and auto-deploys on every push to `main`. No manual deploy step after this is configured.

**Pros:**
- Zero ongoing work — push to `main`, site updates 30–120s later
- Built-in preview deployments for PRs (separate URL per PR)
- Dashboard-visible build history, rollback to any prior deploy
- The wrangler CLI is still useful for inspection but not required for routine updates

**Cons:**
- One OAuth integration to maintain (the link between CF and your GitHub account)
- If the OAuth token is ever revoked, deploys silently fail

### Path B — Wrangler CLI direct deploy

You run `wrangler pages deploy docs --project-name=clio` from the local clone whenever you want to publish a new version. No GitHub integration; Cloudflare doesn't observe the repo at all.

**Pros:**
- No OAuth surface
- Fully under your control — explicit deploy step is a deliberate act
- Easier to script into CI later if you want a non-automatic gate

**Cons:**
- You have to remember to run `wrangler pages deploy` after merging to `main`
- No PR preview deploys
- Build state lives only in Cloudflare's project history, not git-derivable

**Recommendation:** Path A. The static-site-from-a-repo pattern is exactly what the CF Pages GitHub integration is built for. You can always switch to Path B later.

The rest of this runbook follows Path A. Path B steps are summarized at the end.

---

## Path A: Set up Cloudflare Pages via GitHub integration

### Step 1 — Verify the right Cloudflare account is active

```bash
wrangler whoami
```

The output must show `mcwizard1@gmail.com` (or whatever the publisher's CF identity is — must be the same account where `aletheia-api` runs). If it doesn't, run `wrangler logout` then `wrangler login`, completing the browser flow under the correct identity.

### Step 2 — Open the Cloudflare dashboard

https://dash.cloudflare.com → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**

If prompted, authorize the Cloudflare GitHub App. Grant access to the `martymcenroe/Clio` repository specifically (not all repos — keep the scope minimal).

### Step 3 — Configure the Pages project

| Field | Value |
|-------|-------|
| Repository | `martymcenroe/Clio` |
| Project name | `clio` (this becomes `clio.pages.dev` as the default subdomain) |
| Production branch | `main` |
| Build command | *(leave blank)* — the site is pure static HTML, no build step |
| Build output directory | `docs` |
| Root directory | *(leave blank)* — defaults to repo root |
| Environment variables | *(none needed)* |

Click **Save and Deploy**.

Cloudflare starts an initial deploy from `main`. It typically completes in 30–90s. Watch the build log; on success the project lands at `https://clio.pages.dev`.

### Step 4 — First smoke test (subdomain)

Before binding the custom domain, verify the subdomain works:

- `https://clio.pages.dev/` should render `docs/index.html`
- `https://clio.pages.dev/privacy.html` should render `docs/privacy.html`
- `https://clio.pages.dev/privacy` (clean URL) should *also* render the privacy page — confirms the `_redirects` 200-rewrite is being honored

If the clean URL doesn't work, check the **Functions** / **Redirects** tab in the project dashboard and confirm Cloudflare picked up `_redirects`.

### Step 5 — Bind the custom domain

In the Pages project dashboard:

1. **Custom domains** tab → **Set up a custom domain**
2. Enter `cliocast.com` (apex)
3. Click **Continue**

Cloudflare detects that the domain is already on your Cloudflare DNS and offers to configure it automatically.

4. Accept the auto-configuration. Cloudflare creates a `CNAME` record pointing `cliocast.com` (apex) at `clio.pages.dev`, using CNAME flattening (which is how apex CNAMEs work on Cloudflare DNS).
5. (Optional) Repeat for `www.cliocast.com` — adds a CNAME and an automatic redirect to the apex.

DNS propagation is typically immediate inside Cloudflare. HTTPS certificate provisioning takes 30–600 seconds (Let's Encrypt via Cloudflare).

### Step 6 — Verify HTTPS and the custom domain

Wait for the dashboard to show **Active** next to `cliocast.com`. Then:

```bash
curl -sI https://cliocast.com/ | head -1
# Expect: HTTP/2 200

curl -sI https://cliocast.com/privacy | head -1
# Expect: HTTP/2 200 (the 200-rewrite in _redirects keeps the URL clean)

curl -sI https://cliocast.com/wiki | head -1
# Expect: HTTP/2 302
```

Visit `https://cliocast.com/privacy` in a browser. It should render the privacy policy with the clean URL preserved in the address bar.

### Step 7 — Update the GitHub repo metadata

Now that `https://cliocast.com` resolves, set the GitHub repo's `homepage` field to it (plus description and topics) via the classic-PAT script:

```bash
cd /c/Users/mcwiz/Projects/AssemblyZero
poetry run python tools/update_clio_repo_metadata.py
```

Pinentry will prompt for the gpg passphrase. After successful run, visit https://github.com/martymcenroe/Clio and verify the header shows:

- The new description text
- The new topic chips (10 of them)
- The homepage link `https://cliocast.com`

The script closes Clio issue #90 and AssemblyZero issue #1214 on successful run.

### Step 8 — Browser-side end-to-end smoke test

In a fresh browser tab:

1. Visit https://cliocast.com — landing page renders
2. Visit https://cliocast.com/privacy — privacy policy renders, URL stays clean
3. Visit https://cliocast.com/wiki — redirects to the GitHub wiki
4. Visit https://cliocast.com/source — redirects to the GitHub repo
5. Visit https://github.com/martymcenroe/Clio — header shows the new description, topics, and homepage link
6. Click the homepage link from the GitHub header — round-trip to `cliocast.com` works

Done. The CWS listing can now use `https://cliocast.com/privacy` (or `/privacy.html` — both work) as its *Privacy Policy URL*.

---

## Path B (alternative): Wrangler CLI direct deploy

Use this path only if you've decided against the GitHub integration. Each deploy is a deliberate manual act.

### One-time setup

```bash
cd /c/Users/mcwiz/Projects/Clio
wrangler whoami                                  # verify Cloudflare identity
wrangler pages project create clio               # creates the project
wrangler pages deploy docs --project-name=clio   # first deploy
```

The output reports the `clio.pages.dev` URL.

### Bind the custom domain

Same as Path A Step 5 — through the dashboard. Wrangler doesn't (yet) have a stable subcommand for custom-domain binding.

### Deploy on every update

After merging a PR that touches `docs/`:

```bash
cd /c/Users/mcwiz/Projects/Clio
git pull
wrangler pages deploy docs --project-name=clio
```

Each invocation creates a new deployment in the project history; the latest replaces the live site within seconds.

### Update the GitHub repo metadata

Same as Path A Step 7 — `poetry run python tools/update_clio_repo_metadata.py` from the AssemblyZero clone.

---

## Operational notes

### Updating the privacy policy or landing page

Edit `docs/privacy.html`, `docs/index.html`, or `docs/_redirects` on `main` via the normal Clio PR cycle. Cloudflare Pages auto-deploys within 30–120s of the merge commit landing on `main`.

### Rolling back a bad deploy

CF Pages dashboard → **Deployments** → find the previous green deploy → **Rollback to this deployment**. This is faster than a git revert + push and surfaces in the audit trail as a rollback rather than a new commit.

### Adding pages

Drop any `.html` file under `docs/` and it will be reachable at `https://cliocast.com/<filename>`. Add a corresponding `_redirects` rule if you want a clean URL.

### Adding redirects

Edit `docs/_redirects`. Cloudflare Pages re-reads on every deploy. The syntax is `source destination status` per line; status `200` is a rewrite (URL stays clean), `301`/`302` is a redirect (URL changes in the address bar).

---

## Troubleshooting

| Problem | Diagnosis | Action |
|---------|-----------|--------|
| `cliocast.com` resolves to a Cloudflare 522 / 525 | Origin (the Pages project) not yet ready | Wait 60s, retry. If persists, check the Pages project dashboard for deploy errors. |
| `cliocast.com` resolves but shows GitHub Pages 404 | Custom domain bound to the wrong project, or DNS pointing to GHP not CFP | In Cloudflare DNS, verify the CNAME for `cliocast.com` points at `clio.pages.dev`, not at GitHub Pages. |
| HTTPS shows certificate warning | Cert not yet provisioned | Wait up to 10 minutes. If still warning, in the Pages project → Custom domains → click the domain → manually trigger cert reissue. |
| `/privacy` returns 404 but `/privacy.html` works | `_redirects` not picked up by CFP | Check that `_redirects` is at the *root* of the build output dir (`docs/_redirects`, not `docs/some-subfolder/_redirects`). Trigger a redeploy. |
| `wrangler whoami` shows the wrong account | Earlier `wrangler login` ran under a different Google identity | `wrangler logout`, then `wrangler login` and complete the browser flow under `mcwizard1@gmail.com`. |
| GitHub repo header still shows old description after running the metadata script | Hard-cache in the browser | Hard refresh (Ctrl-F5); also verify the script printed `[OK]` for both PATCH and PUT calls. |

---

## Related documents

- `docs/runbooks/30002-chrome-web-store-publish.md` — the Chrome Web Store submission runbook; uses the URL stood up here
- `PRIVACY.md` and `docs/privacy.html` — the content this runbook publishes
- `AssemblyZero/docs/adrs/0216-in-process-classic-pat-decryption.md` — the classic-PAT pattern
- `AssemblyZero/tools/update_clio_repo_metadata.py` — the script Step 7 invokes
- Aletheia equivalent (for reference, with a different hosting choice): `Aletheia/docs/runbooks/10905-runbook-extension-store-publish.md`
