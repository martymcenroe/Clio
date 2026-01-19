# LLD: Auto-Scroll for Lazy-Loaded Gemini Conversations

## Document Info
- **Issue:** https://github.com/martymcenroe/Clio/issues/9
- **PR:** https://github.com/martymcenroe/Clio/pull/10
- **Version:** 2.0 (revised based on Gemini 3 Pro review)

## Problem Statement

Gemini conversations use lazy loading/virtualization. When you open a long conversation, only messages near the current scroll position are rendered in the DOM. Older messages are loaded dynamically as you scroll up.

**Current behavior:** Clio extracts only messages currently in the DOM at extraction time.

**Required behavior:** Extract ALL messages from the conversation, including those not yet loaded.

**Test conversation:** `https://gemini.google.com/app/efdb7649143fefda`

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     content.js                               │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │ findScrollContainer() │    │ scrollToLoadAllMessages()    │   │
│  │ - Locates Gemini's    │    │ - MutationObserver-based     │   │
│  │   scroll viewport     │    │ - Dispatches scroll events   │   │
│  └─────────────────┘    │ - Detects loading spinners    │   │
│                          └──────────────────────────────┘   │
│                                      │                       │
│                                      ▼                       │
│                          ┌──────────────────────────────┐   │
│                          │ extractConversation()         │   │
│                          │ - Called after scroll complete│   │
│                          │ - Extracts all loaded messages│   │
│                          └──────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                     selectors.js                             │
│  - scrollContainer: Gemini-specific scroll element          │
│  - loadingIndicator: Spinner shown during fetch             │
│  - allMessages: Message elements in conversation            │
└─────────────────────────────────────────────────────────────┘
```

### Source Files

| File | Purpose |
|------|---------|
| `extension/src/content.js` | Auto-scroll logic, extraction |
| `extension/src/selectors.js` | DOM selectors for Gemini UI |
| `extension/src/popup.js` | UI, triggers extraction |
| `test/auto-scroll.test.js` | Unit tests for scroll logic |

---

## Previous Implementation (v1.0) - Why It Failed

### Critical Failure #1: Message Counting Fallacy

**The flawed approach:**
```javascript
const currentMessageCount = countMessages();
if (currentMessageCount > lastMessageCount) {
  // assumes new content was added
} else {
  // assumes we are done - WRONG!
}
```

**Why it fails:** Gemini uses **DOM Virtualization** (element recycling). As you scroll up to load new messages, the application *removes* messages at the bottom to save memory. The message count often remains constant (e.g., always ~20 items) even as content changes.

**Result:** Script sees "count did not change," triggers stability exit, stops after ~1 second.

### Critical Failure #2: No Scroll Event Dispatch

**The flawed approach:**
```javascript
scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - SCROLL_CONFIG.scrollStep);
```

**Why it fails:** Modern frameworks (React, Angular) attach listeners to the `scroll` event. Programmatically setting `.scrollTop` does NOT always trigger these listeners.

**Result:** Gemini never "sees" the scroll and doesn't fetch older messages.

### Critical Failure #3: Aggressive Timing

**The flawed config:**
```javascript
scrollDelay: 150,     // Too fast
stabilityChecks: 3,   // 450ms total before exit
```

**Why it fails:** Network requests for history commonly take 500ms+. Script exits before server responds.

### Critical Failure #4: Generic Container Detection

**Why it fails:** If `findScrollContainer()` returns `<body>` but the actual scroll area is a nested div, scrolling does nothing.

---

## Revised Implementation (v2.0)

### Strategy: MutationObserver + Event Dispatch

Instead of counting elements, we:
1. **Observe DOM mutations** - Any node additions/removals indicate successful scrolling
2. **Dispatch scroll events** - Ensure Gemini's framework receives scroll notifications
3. **Detect loading states** - Watch for loading spinners to know when fetching is in progress
4. **Use generous timeouts** - Allow for network latency

### New Configuration

```javascript
const SCROLL_CONFIG = {
  scrollStep: 800,              // Larger steps for efficiency
  scrollDelay: 300,             // More time for network
  mutationTimeout: 2000,        // Wait up to 2s for DOM changes
  maxScrollAttempts: 500,       // Safety limit
  loadingCheckInterval: 100,    // Check loading state frequently
  maxLoadingWait: 10000,        // Max 10s waiting for loading
  progressUpdateInterval: 5     // Update progress every 5 scrolls
};
```

### New Selectors

```javascript
const SELECTORS = {
  // Scroll container - Gemini-specific (to be discovered)
  scrollContainer: '[data-scroll-container], .conversation-scroll, main[role="main"]',

  // Loading indicator - shown while fetching older messages
  loadingIndicator: '[data-loading], .loading-spinner, [aria-busy="true"], mat-spinner',

  // ... existing selectors
};
```

### Core Algorithm

```javascript
async function scrollToLoadAllMessages(onProgress) {
  const scrollContainer = findScrollContainer();
  if (!scrollContainer) {
    return { success: false, error: 'Could not find scroll container' };
  }

  let scrollAttempts = 0;
  let lastScrollTop = scrollContainer.scrollTop;

  // Set up MutationObserver to detect DOM changes
  let mutationDetected = false;
  const observer = new MutationObserver((mutations) => {
    // Any childList mutation means content is changing
    if (mutations.some(m => m.type === 'childList' && m.addedNodes.length > 0)) {
      mutationDetected = true;
    }
  });

  observer.observe(scrollContainer, {
    childList: true,
    subtree: true
  });

  try {
    while (scrollAttempts < SCROLL_CONFIG.maxScrollAttempts) {
      scrollAttempts++;
      mutationDetected = false;

      // Scroll up
      scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - SCROLL_CONFIG.scrollStep);

      // CRITICAL: Dispatch scroll event to trigger framework listeners
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));

      // Wait for potential loading
      await sleep(SCROLL_CONFIG.scrollDelay);

      // Wait for any loading indicator to disappear
      await waitForLoadingComplete();

      // Check if we've reached the top and no mutations occurred
      const atTop = scrollContainer.scrollTop === 0;
      const noMovement = scrollContainer.scrollTop === lastScrollTop;

      if (atTop || noMovement) {
        // Give extra time for final content to load
        await sleep(SCROLL_CONFIG.mutationTimeout);

        if (!mutationDetected) {
          // Truly done - no more content loading
          break;
        }
      }

      lastScrollTop = scrollContainer.scrollTop;

      // Progress update
      if (scrollAttempts % SCROLL_CONFIG.progressUpdateInterval === 0) {
        const messageCount = countMessages();
        reportProgress(`Loading history... (${messageCount} messages, scroll ${scrollAttempts})`);
      }
    }
  } finally {
    observer.disconnect();
  }

  const finalCount = countMessages();
  return {
    success: true,
    messagesLoaded: finalCount,
    scrollAttempts
  };
}

async function waitForLoadingComplete() {
  const startTime = Date.now();

  while (Date.now() - startTime < SCROLL_CONFIG.maxLoadingWait) {
    const loadingEl = document.querySelector(SELECTORS.loadingIndicator);
    if (!loadingEl || loadingEl.offsetParent === null) {
      return; // No loading indicator visible
    }
    await sleep(SCROLL_CONFIG.loadingCheckInterval);
  }
}
```

---

## Test Plan

### Unit Tests (test/auto-scroll.test.js)

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| SCROLL-001 | MutationObserver detects DOM additions | mutationDetected = true |
| SCROLL-002 | Scroll event is dispatched | Event listener receives scroll |
| SCROLL-003 | Loading indicator detection | waitForLoadingComplete waits |
| SCROLL-004 | Reaches top and stops | scrollAttempts < maxScrollAttempts |
| SCROLL-005 | Handles missing scroll container | Returns error object |
| SCROLL-006 | Progress callback invoked | Callback called with message count |
| SCROLL-007 | Timeout on stuck loading | Exits after maxLoadingWait |

### Manual Test Scenarios

| Scenario | Test Case | Expected Result |
|----------|-----------|-----------------|
| MT-001 | Short conversation (< 20 messages) | Extracts all, minimal scrolling |
| MT-002 | Long conversation (100+ messages) | Visible scrolling, all messages extracted |
| MT-003 | Very long conversation (user's test URL) | ZIP ~10x larger, first message captured |
| MT-004 | Slow network (throttled) | Waits for loading, doesn't exit early |

---

## Success Criteria

1. **Functional:**
   - Long conversation extraction captures ALL messages
   - First message of test conversation appears in JSON ("I have a Pixel 8 Pro phone...")
   - ZIP file size proportional to conversation length

2. **Observable:**
   - Progress indicator shows increasing message count
   - Visible scroll animation up through conversation
   - Loading states respected (waits for spinners)

3. **Performance:**
   - Completes within reasonable time (< 60s for 500 messages)
   - Doesn't freeze UI during scroll

4. **Robustness:**
   - Handles network latency gracefully
   - Exits cleanly on error
   - Safety limits prevent infinite loops

---

## Files Modified

| File | Changes |
|------|---------|
| `extension/src/selectors.js` | Add `loadingIndicator` selector |
| `extension/src/content.js` | Rewrite scroll logic with MutationObserver |
| `test/auto-scroll.test.js` | Update tests for new implementation |
| `docs/lld-auto-scroll.md` | This document |
| `docs/runbook-auto-scroll.md` | Operational runbook |

---

## Appendix: DOM Discovery Commands

Run these in DevTools console on a Gemini conversation to discover correct selectors:

### Find Scroll Container
```javascript
document.querySelectorAll('*').forEach(el => {
  const style = getComputedStyle(el);
  if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight) {
    console.log('Scrollable:', el.tagName, el.className, el.id);
  }
});
```

### Find Loading Indicators
```javascript
// Look for spinners, loading states
document.querySelectorAll('[aria-busy], .loading, mat-spinner, [data-loading]')
  .forEach(el => console.log('Loading indicator:', el));
```

### Test Scroll Event
```javascript
const container = document.querySelector('YOUR_SELECTOR');
container.addEventListener('scroll', () => console.log('Scroll event fired!'));
container.scrollTop -= 500;
container.dispatchEvent(new Event('scroll', { bubbles: true }));
```
