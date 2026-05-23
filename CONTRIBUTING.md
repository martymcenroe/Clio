# Contributing to Clio

Thanks for your interest in Clio. Clio is a Chrome extension that extracts full Gemini, Claude, and ChatGPT conversations to structured JSON. All processing happens locally — privacy is a core design constraint, not a feature.

## Development setup

```bash
git clone https://github.com/martymcenroe/Clio.git
cd Clio
npm install
```

### Loading the extension in Chrome

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extensions/` folder

When you change extension source, click the reload button on the Clio card in `chrome://extensions`, then refresh the conversation tab.

## Running tests

```bash
npm test                 # Jest unit tests
npm run test:coverage    # With coverage report
npm run test:e2e         # Playwright end-to-end tests
npm run test:all         # Everything
```

All PRs must pass `npm test` cleanly. See `docs/runbooks/30001-development-runbook.md` for the full development guide.

## Pull requests

- **One issue per PR.** Every PR must reference an open issue with `Closes #N` in the PR body. The naked `(#N)` format is not allowed.
- **Atomic commits.** Each commit should be a coherent unit. Squash before merge.
- **Tests stay real.** Do not mock to make tests pass. If a test is hard to write, that is a design signal.
- **No comments on the obvious.** Lead with well-named identifiers. Comment only when *why* is non-obvious.

## Issues

Please use the provided issue templates (bug report / feature request). If you've found a security vulnerability, do *not* file a public issue — see [SECURITY.md](SECURITY.md) for the private reporting channel.

## Design principles

These are load-bearing — please respect them in any change you propose:

- **Fail open for images.** Image-fetch errors are logged but do not fail the extraction. Text is the primary artifact.
- **Fail closed for text.** If no messages are found, extraction fails loudly — silent partial captures would corrupt the user's archive.
- **Local processing only.** Clio does not send conversation content to any external server. Permissions, host_permissions, and code paths are scoped to enforce this.
- **Minimal manifest surface.** Adding a permission requires an explicit justification in the PR.

## Release process

See `docs/runbooks/30002-chrome-web-store-publish.md` (when present) for the Chrome Web Store submission process. Versioning follows semver as expressed in `extensions/manifest.json`.
