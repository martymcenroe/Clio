# Privacy Policy

**Last updated:** 2026-05-23

## Summary

Clio is a Chrome extension that saves your conversations with Gemini, Claude, and ChatGPT to files on your own computer. **Everything happens inside your browser.** Clio does not send your conversations anywhere, does not collect usage data, and does not gather personal information about you.

This page explains exactly what Clio does and does not do with your data.

## What Clio reads

When you click the Clio button in your browser toolbar while looking at a conversation on one of the supported chat sites, Clio reads the conversation as it appears on the page. That includes:

- Your messages and the assistant's replies
- Code blocks, with the programming-language label preserved
- Images that appear in the conversation
- The assistant's "thinking" or reasoning sections, when those are expanded
- The conversation's title, its identifier, and its web address

Clio packages these pieces into a single ZIP file that contains:

- `conversation.json`: the conversation in a structured text format called JSON (a common format for storing structured data)
- `images/`: the image files

## Where the data goes

Clio writes the ZIP file to your computer through Chrome's standard download flow. Chrome opens its "Save As" window so you can choose where the file is saved. **That is the only place your data is written.**

Clio does not:

- Send your conversation content to any server
- Collect usage data, error reports, or analytics
- Keep any database on our side
- Share your data with anyone
- Track you across sites
- Include any analytics, advertising, or fingerprinting code
- Load any code from the internet (everything Clio runs is bundled into the extension you install)

You can verify all of this by reading the [extension's source code](https://github.com/martymcenroe/Clio). The extension makes network requests only to two kinds of place: (1) the three chat sites it supports (gemini.google.com, claude.ai, and chatgpt.com), to read the conversation you are viewing; and (2) the provider-controlled image-hosting domains where conversations' embedded images live (currently googleusercontent.com, where Gemini stores user-uploaded files). The only requests sent to those image hosts are to download images that already appear in the conversation you are viewing, so the ZIP contains them.

## What permissions Clio asks for, and why

The Chrome Web Store requires extensions to declare and justify every permission they request. Clio asks for the minimum needed to do its job:

| Permission | What it lets Clio do | Why Clio needs it |
|------------|----------------------|-------------------|
| `activeTab` | Read the conversation visible on the tab you are looking at, only at the moment you click the Clio button | To read the conversation you want to save |
| `downloads` | Save the resulting ZIP file to your computer through Chrome's "Save As" window | To deliver the saved conversation to you |
| `host_permissions` for `gemini.google.com`, `claude.ai`, and `chatgpt.com` | Run Clio's reading code only on those three chat sites | These are the only three sites Clio works on |
| `host_permissions` for `googleusercontent.com` (and its subdomains) | Download user-uploaded images from Gemini conversations so they end up in the ZIP | Gemini hosts uploaded files on this domain; without permission, the browser would block the fetch and the images would be missing from your saved copy |
| `scripting` | Re-inject Clio's own reading code into the active tab if it isn't already there | Recovery path only — used when you click Clio on a tab that was open before Clio was installed or last reloaded |

Permissions Clio does **not** ask for: tabs, cookies, web requests, storage, identity, notifications, or access to any other websites.

## Open source

Clio is open source. All the code is at [github.com/martymcenroe/Clio](https://github.com/martymcenroe/Clio) under the MIT License. Anyone can build the extension from source and check that it matches the version they installed. The security policy is at [SECURITY.md](SECURITY.md).

## Your control over your data

Because every Clio file lives only on your own computer, you control your data directly: delete the ZIP files whenever you no longer want them. Clio does not keep any copy of anything to delete on your behalf.

The conversations themselves still live on the chat provider's own servers under their privacy policies. Clio does not change anything about how Google, Anthropic, or OpenAI handle your data. It just gives you a local copy of what already exists on their site.

## GDPR and UK GDPR

The European Union's General Data Protection Regulation (GDPR) and the United Kingdom's UK GDPR give you the right to ask any business that holds personal data about you to show you what it has, correct it, or delete it.

Clio does not hold any personal data about you. Your conversations and the ZIP files Clio creates live only on your device. There is no Clio server, no Clio database, no file on our side that has anything about you in it.

So those rights are met by default. There is nothing for us to show you, correct, or delete, because we do not have anything. You manage your local files yourself, through your own operating system.

The author of Clio is the publisher of the software, not a "data controller" or "data processor" in the GDPR sense. Because of how Clio is built, we cannot collect data about you even if we wanted to.

## Children's privacy

Clio does not collect data from anyone, including children. The Children's Online Privacy Protection Act (COPPA, in the United States) and similar children's-privacy laws in the European Union and elsewhere regulate the collection of personal information from children. Clio does not collect any data at all, so those laws have nothing to apply to. There is no advertising, no tracking, no usage data, and no server that receives anything from the extension.

## Changes to this policy

If this policy changes in a meaningful way, the "Last updated" date at the top will change and the change will be announced in the project's [CHANGELOG.md](CHANGELOG.md).

## Contact

For privacy questions, email **opensource@martymcenroe.ai** with `Clio privacy question` in the subject line.

For security vulnerabilities, please follow the steps in [SECURITY.md](SECURITY.md) instead.
