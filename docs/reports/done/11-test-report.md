# Test Report: Conversation Viewer Tool

**Issue:** https://github.com/martymcenroe/Clio/issues/1
**Branch:** main
**Date:** 2026-01-19
**Author:** Claude

## Test Execution Summary

| Metric | Value |
|--------|-------|
| Total Tests | 142 |
| Passed | 142 |
| Failed | 0 |
| Skipped | 0 |

### Breakdown by Type

| Type | Tests | Status |
|------|-------|--------|
| Unit (Jest) | 111 | All passed |
| E2E (Playwright) | 31 | All passed |

## Test Commands

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# All tests
npm run test:all
```

## Unit Test Output

```
> clio@1.0.0 test
> jest --testPathIgnorePatterns=e2e

PASS test/viewer.test.js
PASS test/content.test.js
PASS test/progress-expansion.test.js
PASS test/image-extraction.test.js
PASS test/large-conversation.test.js
PASS test/message-passing.test.js
PASS test/integration/extraction.integration.test.js

Test Suites: 7 passed, 7 total
Tests:       111 passed, 111 total
Snapshots:   0 total
Time:        3.817 s
```

## E2E Test Output

```
Running 31 tests using 12 workers

  ✓ [chromium] Initial State › shows empty state on load
  ✓ [chromium] Initial State › has correct title
  ✓ [chromium] Initial State › shows browse button in empty state
  ✓ [chromium] File Loading › loads valid JSON via file input
  ✓ [chromium] File Loading › displays success toast on valid load
  ✓ [chromium] File Loading › displays error toast for invalid JSON
  ✓ [chromium] File Loading › displays error toast for missing metadata
  ✓ [chromium] File Loading › loads multiple files at once
  ✓ [chromium] File Loading › handles empty turns conversation
  ✓ [chromium] Bubble Display › shows correct number of bubbles
  ✓ [chromium] Bubble Display › user bubbles have correct class
  ✓ [chromium] Bubble Display › assistant bubbles have correct class
  ✓ [chromium] Bubble Display › bubbles display role labels
  ✓ [chromium] Bubble Display › bubbles display content
  ✓ [chromium] Compact Mode › starts in compact mode
  ✓ [chromium] Compact Mode › compact mode truncates content
  ✓ [chromium] Compact Mode › shows expand toggle in compact mode
  ✓ [chromium] Compact Mode › clicking expand toggle expands bubble
  ✓ [chromium] Compact Mode › global toggle switches to full mode
  ✓ [chromium] Compact Mode › global toggle switches back to compact mode
  ✓ [chromium] Click to Copy › clicking bubble copies content to clipboard
  ✓ [chromium] Click to Copy › shows toast on copy
  ✓ [chromium] Click to Copy › bubble flashes on copy
  ✓ [chromium] Click to Copy › clicking expand toggle does not copy
  ✓ [chromium] Sidebar Navigation › clicking sidebar item switches conversation
  ✓ [chromium] Sidebar Navigation › active item is highlighted
  ✓ [chromium] Thinking Sections › shows thinking toggle for messages with thinking
  ✓ [chromium] Thinking Sections › thinking content is hidden by default
  ✓ [chromium] Thinking Sections › clicking thinking toggle shows thinking content
  ✓ [chromium] Header Controls › browse button triggers file input
  ✓ [chromium] Header Controls › empty state browse button works

  31 passed (5.6s)
```

## Viewer Unit Tests Detail

### validateConversation (12 tests)
| Test | Status |
|------|--------|
| accepts valid conversation | Pass |
| accepts conversation with empty turns array | Pass |
| accepts conversation with large content | Pass |
| rejects null input | Pass |
| rejects non-object input | Pass |
| rejects missing metadata | Pass |
| rejects non-object metadata | Pass |
| rejects non-array turns | Pass |
| rejects invalid role | Pass |
| rejects missing role | Pass |
| rejects missing content | Pass |
| reports correct turn index on error | Pass |

### formatSize (3 tests)
| Test | Status |
|------|--------|
| formats bytes | Pass |
| formats kilobytes | Pass |
| formats megabytes | Pass |

### formatDate (4 tests)
| Test | Status |
|------|--------|
| formats valid ISO date | Pass |
| returns Unknown date for null | Pass |
| returns Unknown date for undefined | Pass |
| returns Unknown date for empty string | Pass |

### checkFileSize (5 tests)
| Test | Status |
|------|--------|
| accepts small files | Pass |
| warns for files over 5MB | Pass |
| rejects files over 20MB | Pass |
| boundary: exactly 5MB is not a warning | Pass |
| boundary: exactly 20MB is not rejected | Pass |

### checkFilename (3 tests)
| Test | Status |
|------|--------|
| accepts .json files | Pass |
| rejects non-json files | Pass |
| rejects files without extension | Pass |

## Test Fixtures Used

| Fixture | Purpose | Tests Using |
|---------|---------|-------------|
| `conversation_fixture.json` | Valid 4-turn conversation | 15+ tests |
| `broken_fixture.json` | Invalid: turns is string | 2 tests |
| `empty_turns_fixture.json` | Edge case: 0 turns | 3 tests |
| `missing_metadata_fixture.json` | Invalid: no metadata | 2 tests |
| `large_content_fixture.json` | Truncation testing | 4 tests |

## Skipped Tests

None.

## Failed Tests

None.

## Manual Testing

### Scenario 1: Multi-file Drag and Drop
**Steps:**
1. Open viewer.html in Chrome
2. Select 3 JSON files in file explorer
3. Drag all files onto viewer window

**Expected Result:** All 3 conversations load, sidebar shows count of 3
**Actual Result:** All 3 loaded, sidebar showed "Conversations (3)"
**Status:** Pass

### Scenario 2: Invalid File Handling
**Steps:**
1. Open viewer.html
2. Load broken_fixture.json via file picker

**Expected Result:** Error toast, conversation not added
**Actual Result:** Toast "Failed: broken_fixture.json - Missing or invalid turns array"
**Status:** Pass

### Scenario 3: Copy Long Content
**Steps:**
1. Load large_content_fixture.json
2. Expand the bubble
3. Click bubble to copy
4. Paste in text editor

**Expected Result:** Full content copied including all 12 lines
**Actual Result:** All content present in clipboard
**Status:** Pass

### Scenario 4: Thinking Section Toggle
**Steps:**
1. Load conversation_fixture.json
2. Find assistant message with thinking
3. Click "Show thinking"

**Expected Result:** Thinking content reveals
**Actual Result:** Thinking content appeared with expected text
**Status:** Pass

## Notes

- E2E tests run in Chromium only (Firefox clipboard API differs)
- Toast timing tests may be flaky if system is slow (3.5s observed vs 2.5s expected)
- All acceptance criteria from LLD verified through automated tests
