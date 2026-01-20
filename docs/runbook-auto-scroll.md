# Runbook: Auto-Scroll for Lazy-Loaded Conversations

## Overview

This runbook covers the auto-scroll feature that loads all messages from lazy-loaded Gemini conversations before extraction.

## Feature Behavior

When a user clicks "Extract Conversation":

1. **Loading Phase:** Blue progress indicator shows "Loading conversation history..."
2. **Scroll Phase:** Page scrolls up automatically to load older messages
3. **Progress Updates:** Indicator shows message count (e.g., "Loading history... (50 messages)")
4. **Completion:** Once all messages loaded, extraction proceeds normally

## Configuration

### Production Settings (`SCROLL_CONFIG`)

| Parameter | Value | Description |
|-----------|-------|-------------|
| `scrollStep` | 800px | Pixels scrolled per step |
| `scrollDelay` | 300ms | Wait between scroll steps |
| `mutationTimeout` | 2000ms | Wait for DOM changes at top |
| `maxScrollAttempts` | 500 | Safety limit |
| `loadingCheckInterval` | 100ms | Loading indicator poll interval |
| `maxLoadingWait` | 10000ms | Max wait for loading spinner |
| `progressUpdateInterval` | 5 | Update progress every N scrolls |

### Test Settings (Fast)

Tests use a faster configuration to complete quickly:
- `scrollDelay`: 10ms
- `mutationTimeout`: 50ms
- `maxScrollAttempts`: 20

## Troubleshooting

### Issue: Extraction completes but messages are missing

**Symptoms:**
- ZIP file is smaller than expected
- First messages of conversation not in JSON
- Progress indicator disappears quickly

**Possible Causes:**
1. Wrong scroll container selected
2. Loading indicator not detected
3. Scroll events not triggering lazy load

**Diagnosis Steps:**
1. Open DevTools Console on Gemini page
2. Run scroll container finder:
```javascript
document.querySelectorAll('*').forEach(el => {
  const style = getComputedStyle(el);
  if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight) {
    console.log('Scrollable:', el.tagName, el.className, el.id);
  }
});
```
3. Update `SELECTORS.scrollContainer` in `selectors.js` if needed

### Issue: Extraction hangs or takes too long

**Symptoms:**
- Progress indicator stuck on "Loading history..."
- Browser becomes unresponsive
- Never completes

**Possible Causes:**
1. Infinite scroll (new messages keep loading)
2. Loading indicator selector matches always-present element
3. maxScrollAttempts too high

**Diagnosis Steps:**
1. Check `metadata.scrollInfo.scrollAttempts` in JSON
2. If near `maxScrollAttempts` (500), may need selector adjustment
3. Check for elements matching `SELECTORS.loadingIndicator` that shouldn't

### Issue: Scroll not triggering message load

**Symptoms:**
- Page visibly scrolls but no new messages appear
- Message count stays constant

**Possible Causes:**
1. Framework not receiving scroll events
2. Need IntersectionObserver instead of scroll events
3. Load requires clicking a "Load more" button

**Diagnosis Steps:**
1. Check if scroll event is being received:
```javascript
const container = document.querySelector('main');
container.addEventListener('scroll', () => console.log('Scroll received'));
```
2. Look for "Load more" or similar buttons at top of conversation

## Selector Updates

If Gemini updates their UI, selectors may need updating.

### Current Selectors (`selectors.js`)

```javascript
scrollContainer: '[data-scroll-container], .conversation-scroll, main, [role="main"]',
loadingIndicator: '[data-loading], .loading-spinner, [aria-busy="true"], mat-spinner, .loading, [role="progressbar"]',
allMessages: '[data-message-author-role], .message-container, .conversation-turn',
```

### How to Update

1. Open Gemini conversation in Chrome
2. Open DevTools Elements panel
3. Find the scrollable conversation container
4. Note its identifying attributes
5. Update `SELECTORS.scrollContainer` in `extensions/src/selectors.js`
6. Run tests: `npm test`
7. Test manually on Gemini

## Monitoring

### Key Metrics in `metadata.scrollInfo`

| Field | Description | Expected |
|-------|-------------|----------|
| `messagesLoaded` | Final message count | > 0 |
| `scrollAttempts` | Number of scroll operations | < maxScrollAttempts |

### Warning Signs

- `scrollAttempts` = `maxScrollAttempts` (500) indicates possible incomplete extraction
- `messagesLoaded` = 0 indicates selector issues
- `partialSuccess: true` may indicate scroll warning

## Development

### Running Tests

```bash
npm test                    # All tests
npm test auto-scroll        # Just auto-scroll tests
npm run test:coverage       # With coverage
```

### Modifying Scroll Config for Testing

```javascript
const { setScrollConfig, resetScrollConfig } = require('./content.js');

// Use fast config
setScrollConfig({
  scrollDelay: 10,
  mutationTimeout: 50
});

// Reset to production defaults
resetScrollConfig();
```

## Files Reference

| File | Purpose |
|------|---------|
| `extensions/src/content.js` | Auto-scroll implementation |
| `extensions/src/selectors.js` | DOM selectors |
| `tests/auto-scroll.test.js` | Unit tests |
| `docs/lld-auto-scroll.md` | Design document |
| `docs/implementation-report-auto-scroll.md` | Implementation details |
| `docs/test-report-auto-scroll.md` | Test results |
