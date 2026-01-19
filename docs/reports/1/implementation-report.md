# Implementation Report: Conversation Viewer Tool

**Issue:** https://github.com/martymcenroe/Clio/issues/1
**Branch:** main
**Date:** 2026-01-19
**Author:** Claude

## Summary

Implemented a single-file HTML viewer for browsing harvested Gemini conversations. The viewer supports drag-and-drop file loading, compact/full view modes, click-to-copy functionality, and thinking section display.

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `viewer/viewer.html` | Added | Generated single-file HTML viewer (built from template + logic) |
| `viewer/viewer.template.html` | Added | HTML template with UI code |
| `viewer/viewer-logic.js` | Added | Pure logic module (unit tested, injected into template) |
| `viewer/build.js` | Added | Build script to generate viewer.html |
| `test/fixtures/conversation_fixture.json` | Added | Valid 4-turn test conversation |
| `test/fixtures/broken_fixture.json` | Added | Invalid JSON: turns is string |
| `test/fixtures/empty_turns_fixture.json` | Added | Edge case: 0 turns |
| `test/fixtures/missing_metadata_fixture.json` | Added | Invalid JSON: no metadata |
| `test/fixtures/large_content_fixture.json` | Added | 12-line content for truncation testing |
| `test/viewer.test.js` | Added | Jest unit tests (32 tests) |
| `test/viewer.e2e.test.js` | Added | Playwright E2E tests (31 tests) |
| `playwright.config.js` | Added | Playwright configuration |
| `package.json` | Modified | Added build script, Playwright dependency, and test scripts |
| `docs/reports/1/lld-conversation-viewer.md` | Added | Low-level design document |
| `docs/runbooks/viewer.md` | Added | User runbook |

## Design Decisions

### Decision 1: Single HTML File Architecture
**Context:** Need portable, zero-dependency viewer
**Decision:** All CSS and JS inlined in one HTML file
**Rationale:** Works offline, no build step, can be opened directly in browser

### Decision 2: textContent for XSS Prevention
**Context:** Conversations may contain malicious code blocks
**Decision:** Render all content via `textContent`, not `innerHTML`
**Rationale:** Eliminates XSS risk completely; formatting preserved via CSS `white-space: pre-wrap`

### Decision 3: Fail-Open with Per-File Toasts
**Context:** Batch loading may include invalid files
**Decision:** Skip invalid files, show toast per failure, load valid files
**Rationale:** Better UX than failing entire batch; user knows exactly which files failed

### Decision 4: Compact Mode Default
**Context:** Need to scroll through 100+ turn conversations quickly
**Decision:** 5-line truncation with fade gradient, per-bubble expand
**Rationale:** Balances readability with navigation speed

### Decision 5: ZIP Support Deferred
**Context:** ZIP adds 90KB dependency (JSZip)
**Decision:** MVP supports JSON only, ZIP planned for Phase 2
**Rationale:** Maintains "lightweight" goal; users can extract JSON from ZIP manually

## Implementation Details

### State Management
Simple object-based state without framework:
```javascript
const AppState = {
  conversations: [],      // Loaded conversation data
  activeIndex: -1,        // Selected conversation
  compactMode: true,      // Global view mode
  expandedBubbles: Set(), // Per-bubble overrides
  expandedThinking: Set() // Thinking section state
};
```

### File Loading Pipeline
1. Validate file size (5MB warning, 20MB reject)
2. Check filename extension (.json only)
3. Parse JSON and validate structure
4. Add to state and render

### Toast Queue System
Prevents toast overlap with sequential processing:
- Each toast displays for 2.5 seconds
- Next toast starts after previous fades out
- Error toasts are red, success green, warning orange

## Known Limitations

- **No ZIP support:** Users must extract `conversation.json` from Clio exports manually (Phase 2)
- **No search:** Cannot search across conversations (Phase 2)
- **No markdown rendering:** Code blocks display as plain text (Phase 2)
- **No image display:** Attached images not rendered (Phase 2)
- **20MB limit:** Large conversations may need splitting

## Testing Summary

- Unit tests: 32 passed, 0 failed
- E2E tests: 31 passed, 0 failed
- Manual testing: Completed

## Verification Checklist

- [x] Code compiles without errors
- [x] All tests pass (111 unit, 31 E2E)
- [x] Documentation updated (runbook, LLD)
- [x] LLD requirements met
- [x] Security considerations addressed (textContent, no network)
- [x] Privacy requirements met (client-side only)

## Notes for Reviewers

1. **Build system:** `viewer.html` is generated from `viewer.template.html` + `viewer-logic.js` via `npm run build:viewer`. This ensures the production code contains the exact same logic that was validated by unit tests (no manual sync required).

2. **Test fixtures location:** Placed in existing `test/fixtures/` alongside extension test fixtures for consistency.

3. **Playwright config:** Only Chromium and Firefox enabled; Safari/WebKit omitted due to clipboard API limitations.

4. **E2E tests rebuild automatically:** The `npm run test:e2e` command runs `build:viewer` first, ensuring E2E tests always run against freshly generated code.
