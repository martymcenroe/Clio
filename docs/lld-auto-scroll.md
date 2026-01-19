# LLD: Auto-Scroll for Lazy-Loaded Gemini Conversations

## Issue Reference
- GitHub Issue: https://github.com/martymcenroe/Clio/issues/9
- PR (not working): https://github.com/martymcenroe/Clio/pull/10

## Problem Statement

Gemini conversations use lazy loading/virtualization. When you open a long conversation, only messages near the current scroll position are rendered in the DOM. Older messages are loaded dynamically as you scroll up.

**Current Clio behavior:** Extracts only messages currently in the DOM at extraction time.

**Expected behavior:** Extract ALL messages from the conversation, including those not yet loaded.

**User report:** Extracted file size is the same regardless of conversation length - indicating auto-scroll is NOT loading additional messages.

## Current Implementation (Not Working)

Location: `extension/src/content.js` lines 184-344

### Functions Added

1. **`findScrollContainer()`** - Attempts to find the scrollable element
   - Tries `SELECTORS.scrollContainer` first
   - Falls back to walking up from conversation container looking for `overflow-y: auto/scroll`
   - Last resort: `document.documentElement` or `document.body`

2. **`scrollToLoadAllMessages()`** - Scrolls up to load messages
   - Scrolls up by `SCROLL_CONFIG.scrollStep` (500px) increments
   - Waits `SCROLL_CONFIG.scrollDelay` (150ms) between scrolls
   - Counts messages via `countMessages()` to detect new loads
   - Stops when at top AND no new messages for 3 consecutive checks

3. **`countMessages()`** - Counts message elements in DOM
   - Uses `SELECTORS.allMessages`
   - Fallback: counts `userMessage` + `assistantMessage` selectors

### Current Selectors (likely wrong)

```javascript
// selectors.js
scrollContainer: '[data-scroll-container], .conversation-scroll, main, [role="main"]',
allMessages: '[data-message-author-role], .message-container, .conversation-turn',
userMessage: '[data-message-author-role="user"], .user-query-container, .query-content',
assistantMessage: '[data-message-author-role="model"], .model-response-container, .response-container',
```

## Investigation Needed

To fix this, someone needs to inspect the actual Gemini page DOM and answer:

### 1. Scroll Container
**Question:** What element is the actual scroll container for the conversation?

Open DevTools on a Gemini conversation and find:
- Which element has `overflow-y: auto` or `overflow-y: scroll`?
- Which element's `scrollTop` changes when you scroll?
- What are its identifying attributes (id, class, data-* attributes)?

**Test in console:**
```javascript
// Find elements with overflow scroll/auto
document.querySelectorAll('*').forEach(el => {
  const style = getComputedStyle(el);
  if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
    if (el.scrollHeight > el.clientHeight) {
      console.log('Scrollable:', el, el.className, el.id);
    }
  }
});
```

### 2. Message Selectors
**Question:** What selector reliably identifies ALL conversation messages?

**Test in console:**
```javascript
// Try various selectors and count
console.log('[data-message-author-role]:', document.querySelectorAll('[data-message-author-role]').length);
console.log('.conversation-turn:', document.querySelectorAll('.conversation-turn').length);
console.log('[data-message-id]:', document.querySelectorAll('[data-message-id]').length);
// Add more as discovered
```

### 3. Lazy Loading Trigger
**Question:** How does Gemini trigger loading of older messages?

- Is it based on scroll position?
- Is there an IntersectionObserver?
- Is there a "Load more" button that needs clicking?
- Does scrolling to `scrollTop = 0` trigger loading?

**Test in console:**
```javascript
// Find the scroll container (once identified) and try scrolling
const container = document.querySelector('YOUR_SELECTOR_HERE');
console.log('Before scroll - messages:', document.querySelectorAll('YOUR_MESSAGE_SELECTOR').length);
container.scrollTop = 0;
setTimeout(() => {
  console.log('After scroll - messages:', document.querySelectorAll('YOUR_MESSAGE_SELECTOR').length);
}, 2000);
```

### 4. Loading Indicator
**Question:** Is there a loading indicator that appears while messages are being fetched?

Look for:
- Spinner elements
- "Loading..." text
- Skeleton/placeholder elements
- Elements that appear/disappear during scroll

### 5. Virtual Scrolling Implementation
**Question:** Does Gemini use virtual scrolling (recycling DOM elements)?

In virtual scrolling, the same DOM elements are reused with different content. If so:
- Total message element count stays constant
- Content changes but element count doesn't
- Need different approach (possibly intercept network requests or use MutationObserver)

## Potential Fixes

### Fix A: Correct Selectors
If the selectors are simply wrong, update `selectors.js` with correct values discovered from DOM inspection.

### Fix B: Different Scroll Container
If we're scrolling the wrong element, update `findScrollContainer()` to target the correct one.

### Fix C: Scroll Behavior
Gemini might require:
- Smooth scrolling instead of instant `scrollTop` changes
- Scrolling in smaller increments
- Waiting longer for content to load
- Triggering scroll events manually: `container.dispatchEvent(new Event('scroll'))`

### Fix D: Click "Load More"
If there's a "Load more" or "Show earlier messages" button:
```javascript
const loadMoreBtn = document.querySelector('LOAD_MORE_SELECTOR');
while (loadMoreBtn && loadMoreBtn.offsetParent !== null) {
  loadMoreBtn.click();
  await sleep(1000);
}
```

### Fix E: MutationObserver
Watch for DOM changes instead of counting:
```javascript
let resolved = false;
const observer = new MutationObserver((mutations) => {
  // Check if new messages were added
});
observer.observe(container, { childList: true, subtree: true });
```

### Fix F: Network Interception
If messages are fetched via API, might need to:
- Wait for specific network requests to complete
- Use `PerformanceObserver` to detect fetch completion

## Test Conversation

User's test conversation: `https://gemini.google.com/app/efdb7649143fefda`

This is a very long conversation that requires extensive scrolling to load all messages.

## Files to Modify

1. `extension/src/selectors.js` - Update selectors based on DOM inspection
2. `extension/src/content.js` - Fix scroll logic based on findings
3. `test/auto-scroll.test.js` - Update tests to match new implementation

## Success Criteria

1. Opening a long conversation and clicking "Extract" should:
   - Show "Loading conversation history..." progress
   - Visibly scroll up through the conversation
   - Take noticeably longer for long conversations
   - Produce a ZIP file ~10x larger than before for the test conversation

2. The `conversation.json` should contain the first message of the conversation ("I have a Pixel 8 Pro phone...")

3. `metadata.scrollInfo.messagesLoaded` should reflect the full message count
