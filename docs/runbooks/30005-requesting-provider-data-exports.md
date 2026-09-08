# 30005 — Requesting your data export from ChatGPT, Claude, and Gemini

**Completion criteria: all three archives downloaded and verified.** Run
`node tools/check-exports.js` to check; it is the definition of done, not this
prose.

## Why we want them

Clio extracts conversations from the **rendered DOM**. A provider's own data
export comes from the **server**. Where they disagree, the export is right and
Clio is wrong, and the disagreement is the only way to see a message the DOM
never showed us.

That matters concretely. Across a three-run sweep of one ChatGPT account, 18
messages were loaded into the DOM and never exported, identically in every run
(#332). Because they are missed every time, they never enter any run's id list,
so run-to-run comparison cannot see them at all — `compare-sweeps.js` says so in
its own output now. The provider export is the only instrument that can.

| Export | What it settles |
|---|---|
| ChatGPT | The 18 deterministically dropped messages (#332), the dropped plain-text user message (#330), and whether reasoning content exists server-side (#316). Blocks #307. |
| Claude | Baseline for #309 — measure Claude before fixing #204, #205, #207, #142. |
| Gemini | Baseline for #309, and #217, which is the image defect #331 wearing a different provider. |

**Request all three in one sitting.** They process in parallel and cost about
five minutes of clicking. Gemini is much the slowest, so start it first.

## Where the files go

```
C:\Users\mcwiz\Projects\clio-harvest\exports\chatgpt\
C:\Users\mcwiz\Projects\clio-harvest\exports\claude\
C:\Users\mcwiz\Projects\clio-harvest\exports\gemini\
```

`clio-harvest` is **not a git repository**, so nothing there can be committed by
accident. That is the point of putting them there.

**Do not put them in the Clio repo.** Clio is public. Its `.gitignore` has a
`data/` rule, and that rule matches only a directory named exactly `data` — it
does **not** cover `data-dl`, `data-g`, or any other `data-*` sibling.

**Move them out of your Downloads folder promptly.** Downloads is frequently
OneDrive-synced, and these archives are your complete conversation history with
each provider — a larger exposure than any single secret. Save straight to the
target directory if the browser lets you choose.

## 1. Gemini (start first — slowest by far)

Gemini conversations are **not** exported from the Gemini UI. They come through
Google Takeout.

1. Go to **takeout.google.com**, signed in as the Google account whose Gemini
   conversations you want.
2. Click **Deselect all** at the top. Takeout defaults to selecting everything,
   which produces an enormous archive.
3. Scroll the product list and tick **Gemini Apps**.
   - If there is no such entry, tick **My Activity** instead, then use its
     **All activity data included** button, **Deselect all**, and tick
     **Gemini Apps** there.
   - On the My Activity route, set the format to **JSON** rather than HTML if
     offered. JSON is parseable; the HTML is a rendering.
4. Click **Next step**.
5. Delivery: **Send download link via email**. Frequency: **Export once**.
   File type **.zip**, size **2 GB** (larger exports split into parts — get all
   of them).
6. Click **Create export**.
7. The email can take **hours to days**. Takeout tells you this and it means it.

## 2. ChatGPT

1. Go to **chatgpt.com**, signed in as the account that was swept.
2. Open **Settings** from the profile menu.
3. Go to **Data controls**.
4. Click **Export data**, then confirm in the dialog.
5. An email arrives titled something like *"ChatGPT — your data export is
   ready"*. Usually **minutes**, sometimes hours.
6. **The download link expires in about 24 hours.** If it lapses, request again.

What you get: `conversations.json` is the one that matters — the full message
tree from the server, including branches and messages the DOM never rendered.
Also `chat.html`, `user.json`, `message_feedback.json`, and a folder of uploaded
and generated media.

## 3. Claude

1. Go to **claude.ai**, signed in.
2. Open **Settings** from the profile menu.
3. Go to **Privacy** (on some accounts it sits under **Account**).
4. Click **Export data** and confirm.
5. An email arrives with a download link, usually within minutes.

What you get: `conversations.json`, `projects.json`, `users.json`.

**Check on arrival whether attachments and images are included.** Claude's
export has historically shipped message text without the attached files. If they
are absent, say so in #309 — it bounds what the Claude baseline can measure, and
it is better known before the analysis than during it.

## If a menu label has moved

These three UIs change their settings layout often, and this runbook will drift.
The thing to look for is the same in all of them: an account or privacy settings
page with a one-shot **export / download your data** action that emails you a
link. It is never on the conversation screen. If you cannot find it in two
minutes, search the provider's help for "export data" rather than hunting menus.

When you find it somewhere new, **fix the step here in the same sitting.** A
runbook nobody corrects is worse than none, because the next person trusts it.

## Verifying you are done

```
node tools/check-exports.js
```

It reports, per provider, whether an archive is present, whether it opens, and
whether the expected top-level file is inside. All three green is the completion
criterion. The checker never prints conversation content.

## Related

- #307 — request the ChatGPT export (the item this runbook exists to unblock)
- #309 — measure Claude and Gemini before fixing them
- #332 — the deterministic drops the ChatGPT export is ground truth for
