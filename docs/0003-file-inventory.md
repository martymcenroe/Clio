# 0003 - File Inventory

This document catalogs key files in the Clio project for onboarding and reference.

## Chrome Extension

| File | Purpose |
|------|---------|
| `extensions/manifest.json` | Chrome MV3 extension configuration |
| `extensions/src/content.js` | DOM extraction logic for Gemini conversations |
| `extensions/src/selectors.js` | Centralized DOM selectors for Gemini UI |
| `extensions/src/popup.html` | Extension popup UI markup |
| `extensions/src/popup.js` | Popup logic, extraction trigger, zip creation |
| `extensions/src/background.js` | Service worker for extension lifecycle |
| `extensions/icons/` | Extension icons (16, 32, 48, 128px) |

## Tests

| File | Purpose |
|------|---------|
| `tests/setup.js` | Jest test setup and configuration |
| `tests/content.test.js` | Content script unit tests |
| `tests/popup.test.js` | Popup script unit tests |
| `tests/auto-scroll.test.js` | Auto-scroll feature tests |
| `tests/fixtures/` | HTML fixtures for testing |

### Test Subdirectories (Standard Structure)

| Directory | Purpose |
|-----------|---------|
| `tests/unit/` | Fast, isolated unit tests |
| `tests/integration/` | Multiple components together |
| `tests/e2e/` | End-to-end browser tests |
| `tests/contract/` | Extension API contract tests |
| `tests/visual/` | Visual regression testing |
| `tests/benchmark/` | Performance tests |
| `tests/security/` | Security tests |
| `tests/accessibility/` | ARIA/WCAG compliance tests |
| `tests/compliance/` | Privacy compliance tests |
| `tests/fixtures/` | Test data (HTML snapshots, JSON) |
| `tests/harness/` | Test utilities and helpers |

## Tools

| File | Purpose |
|------|---------|
| `tools/generate_icons.py` | Generate extension icons from master image |

## Configuration

| File | Purpose |
|------|---------|
| `package.json` | Node.js dependencies |
| `jest.config.js` | Jest test configuration |
| `.claude/` | Claude Code configuration |
| `CLAUDE.md` | Project-specific Claude instructions |
| `GEMINI.md` | Project-specific Gemini instructions |

## Documentation

### Reports (Standard Structure)

| Directory | Purpose |
|-----------|---------|
| `docs/reports/active/` | In-progress reports |
| `docs/reports/done/` | Completed reports (1xxxx-*.md) |
| `docs/lld/active/` | In-progress LLDs |
| `docs/lld/done/` | Completed LLDs (1xxxx-lld.md) |

### Other Docs

| File | Purpose |
|------|---------|
| `docs/implementation-report-auto-scroll.md` | Auto-scroll feature implementation |
| `docs/lld-auto-scroll.md` | Auto-scroll low-level design |
| `docs/runbook-auto-scroll.md` | Auto-scroll operational guide |
| `docs/adrs/` | Architecture Decision Records |
| `docs/session-logs/` | Agent session context |
