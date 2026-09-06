/**
 * Content script for Clio.
 * Handles DOM extraction of conversation data.
 *
 * LLD Reference: docs/reports/1/lld-clio.md
 */

/* global SELECTORS, chrome */

// ============================================================================
// Site Detection
// ============================================================================

/**
 * Get the current site identifier from SELECTORS.
 * @returns {string} - 'gemini', 'claude', 'chatgpt', or 'unknown'
 */
function getSite() {
  return (typeof SELECTORS !== 'undefined' && SELECTORS.site) || 'unknown';
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Sanitize filename for filesystem safety (illegal chars only).
 * @param {string} filename - Raw filename
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(filename) {
  if (!filename) return 'untitled';
  // Remove illegal filesystem characters
  return filename
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 200); // Limit length
}

/**
 * Generate a timestamp string for filenames.
 * @returns {string}
 */
function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
}

/**
 * Wait for a specified duration.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Progress Indicator
// ============================================================================

let progressElement = null;

/**
 * Inject progress indicator into page.
 * @param {string} message - Status message
 */
function showProgress(message) {
  if (!progressElement) {
    progressElement = document.createElement('div');
    progressElement.id = 'clio-progress';
    progressElement.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1a73e8;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: 'Google Sans', sans-serif;
      font-size: 14px;
      z-index: 999999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
    document.body.appendChild(progressElement);
  }
  progressElement.textContent = message;
}

/**
 * Remove progress indicator.
 */
function hideProgress() {
  if (progressElement) {
    progressElement.remove();
    progressElement = null;
  }
}

// ============================================================================
// Selector Validation
// ============================================================================

/**
 * Validate that expected DOM selectors exist.
 * @returns {{valid: boolean, missing: string[]}}
 */
function validateSelectors() {
  const missing = [];

  // Check for conversation container (required)
  const container = document.querySelector(SELECTORS.conversationContainer);
  if (!container) {
    missing.push('conversationContainer');
  }

  // Check for at least one message
  const messages = document.querySelectorAll(SELECTORS.allMessages);
  if (messages.length === 0) {
    // Try fallback - look for any message-like structure
    const userMsgs = document.querySelectorAll(SELECTORS.userMessage);
    const assistantMsgs = document.querySelectorAll(SELECTORS.assistantMessage);
    if (userMsgs.length === 0 && assistantMsgs.length === 0) {
      missing.push('messages');
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

// ============================================================================
// Streaming Detection
// ============================================================================

/**
 * Check if Gemini is currently streaming a response.
 * @returns {boolean}
 */
function isStreaming() {
  const indicators = document.querySelectorAll(SELECTORS.streamingIndicator);
  return indicators.length > 0;
}

// ============================================================================
// Content Expansion
// ============================================================================

/**
 * Expand all collapsed content (user inputs, thinking sections).
 * Shows progress indicator during expansion.
 * IMPORTANT: Only expands content within the conversation container,
 * not sidebar or other page elements.
 * @returns {Promise<number>} - Number of elements expanded
 */
async function expandAllContent() {
  let expandedCount = 0;

  // Find the conversation container to scope our queries
  // This prevents clicking buttons in the sidebar or other UI elements
  const container = document.querySelector(SELECTORS.conversationContainer);
  if (!container) {
    return 0;
  }

  // Find expand buttons ONLY within the conversation container (Gemini only)
  if (SELECTORS.expandButton) {
    const expandButtons = container.querySelectorAll(SELECTORS.expandButton);
    for (const button of expandButtons) {
      // Safety check: skip menu triggers and global UI buttons
      if (button.matches('[aria-haspopup="true"], [aria-haspopup="menu"], .mat-menu-trigger, .mat-mdc-menu-trigger')) {
        continue;
      }
      try {
        button.click();
        expandedCount++;
        await sleep(300);
      } catch (e) {
        // Silently ignore expansion failures
      }
    }
  }

  // Find thinking toggles ONLY within the conversation container
  if (SELECTORS.thinkingToggle) {
    const thinkingToggles = container.querySelectorAll(SELECTORS.thinkingToggle);
    for (const toggle of thinkingToggles) {
      // Safety check: skip if it's a menu trigger
      if (toggle.matches('[aria-haspopup="true"], [aria-haspopup="menu"], .mat-menu-trigger, .mat-mdc-menu-trigger')) {
        continue;
      }
      try {
        toggle.click();
        expandedCount++;
        await sleep(300);
      } catch (e) {
        // Silently ignore expansion failures
      }
    }
  }

  return expandedCount;
}

// ============================================================================
// Auto-Scroll to Load All Messages (v2.0 - MutationObserver based)
// ============================================================================

/**
 * Configuration for auto-scroll behavior.
 * v2.0: Revised with longer delays and MutationObserver strategy.
 *
 * LLD Reference: docs/lld-auto-scroll.md
 */
let SCROLL_CONFIG = {
  scrollStep: 5000,             // Large scroll to trigger batch loading
  scrollDelay: 500,             // 500ms between scrolls
  loadingAppearDelay: 500,      // 500ms wait for loading indicator to appear
  mutationTimeout: 2000,        // Wait up to 2s for DOM changes after reaching top
  maxScrollAttempts: 500,       // Multiple scrolls needed to hit buffer edge
  loadingCheckInterval: 100,    // Check loading state every 100ms
  maxLoadingWait: 15000,        // Max 15s waiting for a single loading state
  progressUpdateInterval: 2     // Update progress more frequently
};

/**
 * Override scroll config (for testing).
 * @param {Object} overrides - Config values to override
 */
function setScrollConfig(overrides) {
  SCROLL_CONFIG = { ...SCROLL_CONFIG, ...overrides };
}

/**
 * Reset scroll config to defaults (for testing).
 */
function resetScrollConfig() {
  SCROLL_CONFIG = {
    scrollStep: 800,
    scrollDelay: 500,
    mutationTimeout: 3000,
    maxScrollAttempts: 500,
    loadingCheckInterval: 100,
    maxLoadingWait: 15000,
    progressUpdateInterval: 5
  };
}

/**
 * Count current messages in the DOM.
 * Note: In virtualized lists, this count may stay constant even as content changes.
 * Used for progress reporting, not for detecting scroll completion.
 * @returns {number} - Number of message elements
 */
function countMessages() {
  const site = getSite();
  if (site === 'claude') {
    // Assistant turns: one .font-claude-response per turn. Do not use
    // action-bar-copy (appears on user messages too, inflated the count —
    // issue #32). Do not use .row-start-2 (broken on pre-redesign Claude — #114).
    const userMsgs = document.querySelectorAll('[data-testid="user-message"]');
    const assistantMsgs = document.querySelectorAll('.font-claude-response:not(.font-claude-response-body)');
    return userMsgs.length + assistantMsgs.length;
  }
  if (site === 'chatgpt') {
    return document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]').length;
  }
  // Gemini: Count ONLY primary elements (user-query, model-response)
  // Don't use composite SELECTORS which include fallbacks that may be nested
  // This prevents double-counting when .user-query-container is inside user-query
  const userMsgs = document.querySelectorAll('user-query, [data-message-author-role="user"]');
  const assistantMsgs = document.querySelectorAll('model-response, [data-message-author-role="model"]');
  return userMsgs.length + assistantMsgs.length;
}

/**
 * Find the scrollable container for the conversation.
 * @returns {Element|null} - The scroll container element
 */
/**
 * Does this element actually scroll?
 *
 * `scrollHeight > clientHeight` alone is NOT enough: it is true of any element
 * taller than its box, scrolling or not. ChatGPT's <main> measures 4261px in an
 * 898px box but has overflow:visible, so assigning scrollTop is a no-op — which
 * is exactly how conversations exported with only the visible messages (#255).
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isRealScroller(el) {
  if (!el) return false;
  if (el === document.documentElement || el === document.body) {
    return el.scrollHeight > el.clientHeight;
  }
  const overflowY = window.getComputedStyle(el).overflowY;
  return (overflowY === 'auto' || overflowY === 'scroll') &&
         el.scrollHeight > el.clientHeight;
}

/**
 * Find the scrollable container for the conversation.
 * @returns {Element|null} - The scroll container element
 */
function findScrollContainer() {
  // Selector matches, in SELECTOR order. querySelector() with a selector list
  // returns the first match in DOCUMENT order, so for a list like
  // 'main [class*="overflow-y-auto"], main' the ancestor <main> always won and
  // the intended first choice was dead code (#255). Iterate instead.
  const matches = SELECTORS.scrollContainer
    ? Array.from(document.querySelectorAll(SELECTORS.scrollContainer))
    : [];
  for (const el of matches) {
    if (isRealScroller(el)) return el;
  }

  const conversationContainer = document.querySelector(SELECTORS.conversationContainer);

  if (!conversationContainer) {
    // No conversation on this page. A merely-tall selector match is still
    // better than nothing (the pre-#255 behaviour); otherwise there is nothing
    // to scroll and saying so beats handing back <body>.
    for (const el of matches) {
      if (el.scrollHeight > el.clientHeight) return el;
    }
    return null;
  }

  {
    // Walk UP. On ChatGPT the real scroller is `div.group/scroll-root`, two
    // levels ABOVE <main> — an ancestor, not a descendant.
    let element = conversationContainer;
    while (element && element !== document.body) {
      if (isRealScroller(element)) return element;
      element = element.parentElement;
    }

    // Then DOWN, for layouts that put the scroller inside the conversation
    // container. Prefer one that actually holds messages.
    const inside = Array.from(conversationContainer.querySelectorAll('*'))
      .filter(isRealScroller);
    const withMessages = inside.filter(el => el.querySelector(SELECTORS.allMessages));
    if (withMessages.length) return withMessages[0];
    if (inside.length) return inside[0];
  }

  // Legacy permissive behaviour, kept as a fallback so Gemini and Claude cannot
  // regress if a real scroller is not identified above.
  for (const el of matches) {
    if (el.scrollHeight > el.clientHeight) return el;
  }

  if (document.documentElement.scrollHeight > document.documentElement.clientHeight) {
    return document.documentElement;
  }

  return document.body;
}

// ============================================================================
// Message capture during scroll (#256)
// ============================================================================

/**
 * ChatGPT virtualizes the message list: as older messages load during a
 * scroll-back, newer ones are REMOVED from the DOM. Measured on a real
 * conversation: 53 distinct messages passed through the DOM, never more than 22
 * present at once. Reading the DOM after the scroll therefore sees one window,
 * not the conversation.
 *
 * So messages are captured as they render and kept here, keyed by
 * data-message-id. Values are detached deep clones, which the per-turn
 * extractors read exactly like live nodes.
 *
 * @type {Map<string, {el: Element, seq: number, fromBottom: number|null,
 *                     measuredSettled: boolean}>}
 */
let MESSAGE_CACHE = new Map();
let MESSAGE_CACHE_SEQ = 0;

/**
 * The scroller the ordering key is measured against, fixed for one scroll pass.
 * findScrollContainer() walks the whole document, which is far too expensive to
 * repeat inside a MutationObserver, so it is resolved once and cached.
 * @type {Element|null}
 */
let MESSAGE_SCROLLER = null;

/**
 * How many citation favicons were dropped this extraction (#279).
 *
 * Counted rather than merely skipped. Silently discarding 152 images per
 * capture would swap one unreadable number for no number at all, and the point
 * of the change is that the export should say what it did, not say less.
 * @type {number}
 */
let DECORATION_SKIPPED = 0;

/** Reset the decoration counter (called per extraction, and by tests). */
function resetDecorationCount() {
  DECORATION_SKIPPED = 0;
}

/** How many citation favicons were skipped since the last reset. */
function getDecorationCount() {
  return DECORATION_SKIPPED;
}

/** Fix the scroller for this scroll pass (and let tests supply a fake). */
function setMessageScroller(el) {
  MESSAGE_SCROLLER = el || null;
}

/**
 * Distance from the BOTTOM of the scroller to the top of this element.
 *
 * This is the ordering key, and it is the only one that survives lazy loading
 * (#264). The obvious candidates both fail:
 *
 *   data-testid="conversation-turn-N"  is provisional while the conversation
 *       loads — observed taking values 1..14 mid-scroll and 1..288 once
 *       settled, so a message captured early carries a stale small number and
 *       the transcript sorts into a handful of buckets.
 *   DOM position  describes one window; virtualization evicts the rest.
 *
 * Distance from the bottom is invariant because prepending older content above
 * increases scrollHeight by D and pushes every existing element's offset down
 * by the same D, so (scrollHeight - offsetTop) does not move. Larger = further
 * from the end = earlier in the conversation.
 *
 * @param {Element} el
 * @param {Element|null} scroller
 * @returns {number|null} null when it cannot be measured honestly
 */
function measureFromBottom(el, scroller) {
  if (!scroller || !el || typeof el.getBoundingClientRect !== 'function') return null;
  // A container that does not actually scroll gives a meaningless key.
  if (!(scroller.scrollHeight > scroller.clientHeight)) return null;
  const r = el.getBoundingClientRect();
  // Height 0 means the node is in the DOM but not yet laid out — a measurement
  // here is junk, and junk that outranks "unknown" is worse than no key at all.
  if (!r || !r.height) return null;
  const sr = scroller.getBoundingClientRect();
  const offsetTop = r.top - sr.top + scroller.scrollTop;
  return scroller.scrollHeight - offsetTop;
}

/**
 * Snapshot every message currently rendered that we have not already kept, and
 * measure where it sits.
 * Cheap and idempotent — safe to call on every scroll tick and every mutation.
 * @returns {number} how many new messages were captured
 */
function captureRenderedMessages() {
  let added = 0;
  for (const el of document.querySelectorAll(SELECTORS.allMessages)) {
    const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id');
    if (!id) continue;
    captureMessageArtifacts(el, id);
    if (MESSAGE_CACHE.has(id)) continue;
    MESSAGE_CACHE.set(id, {
      el: el.cloneNode(true),
      seq: MESSAGE_CACHE_SEQ++,
      fromBottom: measureFromBottom(el, MESSAGE_SCROLLER),
      measuredSettled: false
    });
    added++;
  }
  return added;
}

/**
 * Re-measure everything currently rendered, from a settled DOM.
 *
 * captureRenderedMessages() measures at first sight, and first sight is a
 * MutationObserver callback — which fires DURING a framework update, when a
 * node can be in the DOM but not yet in its final position. One bad
 * measurement is permanent and silently corrupts the order, reporting success
 * the whole way. So the driver calls this between scroll rounds, when layout
 * has settled, and the settled value wins.
 *
 * @returns {number} how many cached messages were re-measured
 */
function remeasureRenderedMessages() {
  if (!MESSAGE_SCROLLER) return 0;
  let n = 0;
  for (const el of document.querySelectorAll(SELECTORS.allMessages)) {
    const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id');
    const entry = id && MESSAGE_CACHE.get(id);
    if (!entry) continue;
    const measured = measureFromBottom(el, MESSAGE_SCROLLER);
    if (measured === null) continue;
    entry.fromBottom = measured;
    entry.measuredSettled = true;
    n++;
  }
  return n;
}

/**
 * Every message seen during the scroll, in conversation order.
 * Falls back to the live DOM when nothing was captured (sites without
 * data-message-id, or extraction invoked without a scroll phase).
 * @returns {Element[]}
 */
function getCapturedMessageEls() {
  if (MESSAGE_CACHE.size === 0) {
    return Array.from(document.querySelectorAll(SELECTORS.allMessages));
  }
  const entries = Array.from(MESSAGE_CACHE.values());
  const measured = entries.filter(e => typeof e.fromBottom === 'number');
  // Anything that could never be measured is appended rather than dropped — a
  // capture that cannot be ordered must still not go missing — and counted, so
  // an ordering failure cannot masquerade as success. Capture order is the only
  // thing left to sort them by; with no scroll pass at all that is DOM order,
  // which is correct.
  const unmeasured = entries.filter(e => typeof e.fromBottom !== 'number');
  measured.sort((a, b) => (b.fromBottom - a.fromBottom) || (a.seq - b.seq));
  unmeasured.sort((a, b) => a.seq - b.seq);
  return measured.concat(unmeasured).map(e => e.el);
}

/**
 * How trustworthy the reconstructed order is, for the export's metadata.
 * @returns {{captured: number, withOrderKey: number, withoutOrderKey: number,
 *            measuredOnSettledDom: number, neverMeasuredOnSettledDom: number}}
 */
function getCaptureOrderStats() {
  let withOrderKey = 0;
  let measuredOnSettledDom = 0;
  for (const entry of MESSAGE_CACHE.values()) {
    if (typeof entry.fromBottom === 'number') withOrderKey++;
    if (entry.measuredSettled) measuredOnSettledDom++;
  }
  return {
    captured: MESSAGE_CACHE.size,
    withOrderKey,
    withoutOrderKey: MESSAGE_CACHE.size - withOrderKey,
    measuredOnSettledDom,
    neverMeasuredOnSettledDom: MESSAGE_CACHE.size - measuredOnSettledDom
  };
}

/** Drop the cache (called at the start of each scroll, and by tests). */
function resetMessageCache() {
  MESSAGE_CACHE = new Map();
  MESSAGE_CACHE_SEQ = 0;
  MESSAGE_ARTIFACTS = new Map();
  MESSAGE_SCROLLER = null;
}

// ============================================================================
// Attached-file capture during scroll (#262)
// ============================================================================

/**
 * Files attached to a message, accumulated across the scroll.
 *
 * Keyed by message id; each entry holds two maps deduped by their own natural
 * key, because the same message is swept many times.
 *
 * @type {Map<string, {files: Map<string, Object>, downloads: Map<string, Object>}>}
 */
let MESSAGE_ARTIFACTS = new Map();

/** Download labels that are site chrome rather than a conversation artifact. */
const DOWNLOAD_LABEL_NOISE = /^download\s+(apps?|the\s+app)$/i;

/**
 * Text lines of an element, without depending on innerText.
 *
 * innerText is what a browser gives for "the rendered lines", but jsdom does
 * not implement it, so a fixture test of a two-line file card would silently
 * read one run-together string. Falling back to leaf nodes gives the same
 * lines in both.
 *
 * @param {Element} el
 * @returns {string[]}
 */
function elementTextLines(el) {
  if (el && typeof el.innerText === 'string' && el.innerText.trim()) {
    return el.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  }
  const leaves = Array.from(el.querySelectorAll('*'))
    .filter(e => e.children.length === 0 && (e.textContent || '').trim())
    .map(e => e.textContent.trim());
  if (leaves.length) return leaves;
  const text = (el.textContent || '').trim();
  return text ? [text] : [];
}

/**
 * Record every file affordance visible on this message right now.
 *
 * Timing is the whole point (#262). A pass that runs after the scroll sees only
 * the oldest window, because virtualization has evicted everything else — which
 * is why a conversation carrying artifacts throughout produced zero. This runs
 * on every sweep, from LIVE nodes rather than the cached clone, because a
 * download control can render after the message is first seen.
 *
 * Two classes, and they are not equivalent:
 *
 *   uploaded    [data-testid="library-file-icon"] cards, all in user messages.
 *               Probed on the live page: no button, no link, no clickable
 *               ancestor, and the icon sits under a `pointer-events-none`
 *               wrapper. The name and kind are recoverable; the bytes are not
 *               reachable from the transcript at all.
 *   generated   real "Download <name>" controls on assistant output, which
 *               exist only while their message is rendered.
 *
 * @param {Element} el - the LIVE message element
 * @param {string} id  - its data-message-id
 */
function captureMessageArtifacts(el, id) {
  if (!SELECTORS.uploadedFileCard && !SELECTORS.downloadAffordance) return;

  let entry = MESSAGE_ARTIFACTS.get(id);
  if (!entry) {
    entry = { files: new Map(), downloads: new Map() };
    MESSAGE_ARTIFACTS.set(id, entry);
  }

  if (SELECTORS.uploadedFileCard) {
    for (const icon of el.querySelectorAll(SELECTORS.uploadedFileCard)) {
      // Walk up to the card: the icon itself carries no text.
      let card = icon;
      for (let i = 0; i < 6 && card.parentElement && card.parentElement !== el; i++) {
        card = card.parentElement;
        if ((card.textContent || '').trim().length > 3) break;
      }
      const lines = elementTextLines(card);
      const name = lines[0];
      if (!name || entry.files.has(name)) continue;
      entry.files.set(name, {
        type: 'file',
        name,
        kind: lines[1] || null,
        // Stated, not implied: these cards expose no way to reach the bytes.
        downloadable: false,
        filename: null
      });
    }
  }

  if (SELECTORS.downloadAffordance) {
    for (const control of el.querySelectorAll(SELECTORS.downloadAffordance)) {
      const label = (control.getAttribute('aria-label') ||
                     control.textContent || '').trim();
      if (!/^download\b/i.test(label)) continue;
      if (DOWNLOAD_LABEL_NOISE.test(label)) continue;
      if (entry.downloads.has(label)) continue;
      // "Download SAM-Codex-Recon-Runtime-Promote-v1.0.2.py" carries the name;
      // the generic "Download file" does not, and must not invent one.
      const rest = label.replace(/^download\s+/i, '').trim();
      const looksLikeFilename = /^[^\s]+\.[A-Za-z0-9]{1,10}$/.test(rest);
      entry.downloads.set(label, {
        type: 'artifact',
        name: looksLikeFilename ? rest : null,
        label,
        downloadable: true,
        filename: null
      });
    }
  }
}

/**
 * Everything captured for one message, as attachment records.
 * @param {string} id
 * @returns {Array<Object>}
 */
function getMessageArtifacts(id) {
  const entry = MESSAGE_ARTIFACTS.get(id);
  if (!entry) return [];
  return [...entry.files.values(), ...entry.downloads.values()];
}

/**
 * Wait for any visible loading indicator to disappear.
 * @returns {Promise<void>}
 */
async function waitForLoadingComplete() {
  const startTime = Date.now();

  while (Date.now() - startTime < SCROLL_CONFIG.maxLoadingWait) {
    const loadingEl = document.querySelector(SELECTORS.loadingIndicator);
    // Check if loading element exists and is visible (offsetParent !== null)
    if (!loadingEl || loadingEl.offsetParent === null) {
      return; // No loading indicator visible
    }
    await sleep(SCROLL_CONFIG.loadingCheckInterval);
  }
  // Timeout reached, continue anyway
}

/**
 * Scroll to load all messages in a lazy-loaded conversation.
 * Uses MutationObserver to detect DOM changes instead of counting messages.
 * Dispatches scroll events to ensure framework listeners are triggered.
 *
 * v2.0: Addresses virtualized list issues where message count stays constant.
 *
 * @param {function} onProgress - Callback for progress updates (optional)
 * @returns {Promise<{success: boolean, messagesLoaded: number, scrollAttempts: number}>}
 */
async function scrollToLoadAllMessages(onProgress) {
  const scrollContainer = findScrollContainer();
  if (!scrollContainer) {
    return {
      success: false,
      error: 'Could not find scroll container',
      messagesLoaded: 0,
      scrollAttempts: 0
    };
  }

  let scrollAttempts = 0;
  let lastScrollTop = scrollContainer.scrollTop;
  let consecutiveNoMovement = 0;

  // Track DOM mutations to detect content loading (handles virtualized lists)
  // The list is virtualized: messages loaded early in the scroll are evicted
  // before the scroll ends, so they must be kept as they render (#256).
  resetMessageCache();
  // Fix the scroller BEFORE the first sweep: it is what the ordering key is
  // measured against, and the opening window would otherwise be captured with
  // no key at all (#264).
  setMessageScroller(scrollContainer);
  captureRenderedMessages();

  let mutationDetected = false;
  const observer = new MutationObserver((mutations) => {
    // Capture first — an evicted message is gone by the next tick.
    captureRenderedMessages();

    // Any childList mutation with added nodes indicates content is changing
    for (const mutation of mutations) {
      if (mutation.type === 'childList' &&
          (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
        mutationDetected = true;
        break;
      }
    }
  });

  // Observe the scroll container and its descendants for DOM changes
  observer.observe(scrollContainer, {
    childList: true,
    subtree: true
  });

  // Progress callback helper
  const reportProgress = (message) => {
    showProgress(message);
    if (onProgress) onProgress(message);
  };

  const initialCount = countMessages();
  reportProgress(`Loading conversation history... (${initialCount} messages visible)`);

  // Logging helper (disabled - enable for debugging)
  const logScroll = (msg, data = {}) => {
    // console.log(`[Clio Scroll #${scrollAttempts}]`, msg, data);
  };

  try {
    while (scrollAttempts < SCROLL_CONFIG.maxScrollAttempts) {
      scrollAttempts++;
      mutationDetected = false;

      // Belt and braces alongside the observer: a mutation batch can be
      // coalesced, and a message evicted in the same batch would be lost.
      captureRenderedMessages();

      const beforeCount = countMessages();
      const beforeScroll = scrollContainer.scrollTop;

      // Scroll up
      const targetScrollTop = Math.max(0, scrollContainer.scrollTop - SCROLL_CONFIG.scrollStep);
      scrollContainer.scrollTop = targetScrollTop;

      // CRITICAL: Dispatch scroll event to trigger framework listeners
      // Modern SPAs often only respond to events, not direct property changes
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));

      // Short wait for loading indicator to APPEAR
      await sleep(SCROLL_CONFIG.loadingAppearDelay);

      // Check if loading indicator appeared
      const loadingEl = document.querySelector(SELECTORS.loadingIndicator);
      const loadingBefore = !!loadingEl;

      // Log loading indicator status for debugging
      if (scrollAttempts <= 5 || scrollAttempts % 10 === 0) {
        logScroll('Loading check', {
          found: loadingBefore,
          selector: SELECTORS.loadingIndicator,
          element: loadingEl ? loadingEl.tagName : 'none'
        });
      }

      // If loading indicator is visible, wait for it to disappear
      // This ensures we wait for the full batch to load
      if (loadingBefore) {
        logScroll('Waiting for loading to complete...');
        await waitForLoadingComplete();
        logScroll('Loading complete!');
      } else {
        // No loading indicator - wait a bit in case content is loading without indicator
        await sleep(SCROLL_CONFIG.scrollDelay);
      }

      const loadingAfter = !!document.querySelector(SELECTORS.loadingIndicator);
      const afterCount = countMessages();

      // Layout has settled for this round: overwrite any ordering key taken
      // inside the observer, mid-framework-update (#264).
      captureRenderedMessages();
      remeasureRenderedMessages();

      // Check current state
      const currentScrollTop = scrollContainer.scrollTop;
      const atTop = currentScrollTop === 0;
      const noMovement = currentScrollTop === lastScrollTop;

      // Log every 10 scrolls or on significant events
      if (scrollAttempts % 10 === 0 || loadingBefore || mutationDetected || afterCount !== beforeCount) {
        logScroll('Status', {
          messages: `${beforeCount} → ${afterCount}`,
          scroll: `${Math.round(beforeScroll)} → ${Math.round(currentScrollTop)}`,
          loading: loadingBefore ? (loadingAfter ? 'STILL LOADING' : 'loaded') : 'none',
          mutation: mutationDetected,
          atTop,
          noMovement
        });
      }

      if (atTop || noMovement) {
        consecutiveNoMovement++;
        logScroll('At top/stuck', { consecutiveNoMovement, mutationDetected });

        // Give extra time for final content to load
        await sleep(SCROLL_CONFIG.mutationTimeout);

        // If we're at top/stuck AND no mutations detected, we're done
        if (!mutationDetected && consecutiveNoMovement >= 2) {
          captureRenderedMessages();
          remeasureRenderedMessages();
          const finalCount = Math.max(countMessages(), MESSAGE_CACHE.size);
          logScroll('COMPLETE', { finalMessages: finalCount, totalScrolls: scrollAttempts });
          reportProgress(`Loaded ${finalCount} messages`);
          return {
            success: true,
            messagesLoaded: finalCount,
            scrollAttempts
          };
        }

        // Mutations detected or first time at top - keep trying
        if (mutationDetected) {
          consecutiveNoMovement = 0;
        }
      } else {
        // Successfully scrolled, reset counter
        consecutiveNoMovement = 0;
      }

      lastScrollTop = currentScrollTop;

      // Progress update (to UI)
      if (scrollAttempts % SCROLL_CONFIG.progressUpdateInterval === 0) {
        const currentCount = countMessages();
        reportProgress(`Loading history... (${currentCount} messages, scroll ${scrollAttempts})`);
      }
    }
  } finally {
    // Always clean up the observer
    observer.disconnect();
  }

  // Hit max attempts - return what we have
  captureRenderedMessages();
  remeasureRenderedMessages();
  const finalCount = Math.max(countMessages(), MESSAGE_CACHE.size);
  return {
    success: true,
    messagesLoaded: finalCount,
    scrollAttempts,
    warning: `Reached maximum scroll attempts (${SCROLL_CONFIG.maxScrollAttempts}). Conversation may be incomplete.`
  };
}

// ============================================================================
// Metadata Extraction
// ============================================================================

/**
 * Extract session title from page header.
 * @returns {string}
 */
function extractTitle() {
  if (SELECTORS.sessionTitle) {
    const titleEl = document.querySelector(SELECTORS.sessionTitle);
    if (titleEl) {
      return titleEl.textContent.trim();
    }
  }
  // Fallback: use document title, stripping site suffix
  const site = getSite();
  let title = document.title;
  if (site === 'claude') {
    title = title.replace(/ - Claude$/, '');
  } else if (site === 'gemini') {
    title = title.replace(/ - Gemini$/, '');
  }
  // ChatGPT: title is already clean (no suffix)
  return title.trim() || 'Untitled Conversation';
}

/**
 * Extract conversation ID from URL.
 * @returns {string}
 */
function extractConversationId() {
  const site = getSite();
  if (site === 'claude') {
    // Claude URL: /chat/{uuid}
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/i);
    return match ? match[1] : 'unknown';
  }
  if (site === 'chatgpt') {
    // ChatGPT URL: /c/{uuid}
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/i);
    return match ? match[1] : 'unknown';
  }
  // Gemini URL: /app/{hex}
  const match = window.location.pathname.match(/\/app\/([a-f0-9]+)/i);
  return match ? match[1] : 'unknown';
}

// ============================================================================
// Turn Extraction
// ============================================================================

// Words that appear in a code block's header alongside (or instead of) the
// language. A header reading "python  Copy  Edit" must not yield "Copy".
const CODE_HEADER_NOISE = new Set([
  'copy', 'copied', 'edit', 'run', 'share', 'download', 'expand', 'collapse',
  'wrap', 'unwrap', 'preview', 'code', 'copy code', 'ask chatgpt'
]);

// Spellings of the same language, normalised so an export picks one extension.
const LANGUAGE_ALIASES = {
  py: 'python', python3: 'python',
  js: 'javascript', node: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  yml: 'yaml', md: 'markdown', rb: 'ruby', 'c++': 'cpp', 'c#': 'csharp'
};

/** Interpreters worth trusting from a shebang line. */
const SHEBANG_LANGUAGES = {
  python: 'python', bash: 'bash', sh: 'bash', zsh: 'bash', dash: 'bash',
  node: 'javascript', deno: 'javascript', ruby: 'ruby', perl: 'perl',
  pwsh: 'powershell'
};

/**
 * The OUTERMOST <pre> around an element.
 *
 * `closest('pre')` is not enough, and this is the whole reason #263 survived a
 * first repair. ChatGPT nests its code blocks:
 *
 *   pre.overflow-visible > … > div.cm-editor > div.cm-scroller > pre.cm-content > code
 *
 * so `closest('pre')` stops at the INNER CodeMirror pre. Any header sits above
 * the editor, in the outer pre — outside that scope entirely. Searching the
 * inner pre for a label can never find one no matter how good the selector is.
 * Verified on the live page 2026-09-05: 64 of 64 blocks had this shape.
 *
 * @param {Element} el
 * @returns {Element|null}
 */
function outermostPre(el) {
  if (!el || typeof el.closest !== 'function') return null;
  let outer = el.closest('pre');
  if (!outer) return null;
  while (outer.parentElement) {
    const above = outer.parentElement.closest('pre');
    if (!above) break;
    outer = above;
  }
  return outer;
}

/**
 * Best available language for a code block.
 *
 * Tried in descending order of proof:
 *   1. a `language-*` class or data-language attribute — an explicit statement;
 *   2. the block's header label, read from the OUTER pre;
 *   3. the code itself, sniffed, and only where the evidence is unambiguous.
 *
 * Step 3 is not a nicety. Probed on the live page over 64 blocks, ChatGPT's
 * current markup carries no class, no data attribute and no header at all —
 * there is nothing to read, which is why 540 of 606 blocks came back
 * unlabelled. Where a label exists it still wins; where none does, the content
 * is the only remaining evidence.
 *
 * @param {Element} code - the <code> (or CodeMirror content) element
 * @param {Element} pre  - its enclosing <pre>
 * @returns {string} the language, lowercased and normalised, or '' when unknown
 */
function detectCodeLanguage(code, pre) {
  // Look in the outer block, not the inner CodeMirror pre — see outermostPre.
  const scope = outermostPre(code) || outermostPre(pre) || pre;

  const fromClass = (el) => {
    if (!el || !el.classList) return '';
    for (const cls of el.classList) {
      const m = cls.match(/^(?:language|lang|highlight)[-_](.+)$/i);
      if (m && m[1]) return m[1];
    }
    return '';
  };
  const attr = (el, name) => (el && typeof el.getAttribute === 'function'
    ? el.getAttribute(name) : null);
  const firstText = (el, sel) => {
    const hit = el && el.querySelector && el.querySelector(sel);
    return hit ? (attr(hit, 'data-language') || hit.textContent) : '';
  };

  const declared =
    fromClass(code) ||
    fromClass(pre) ||
    fromClass(scope) ||
    attr(code, 'data-language') ||
    attr(pre, 'data-language') ||
    attr(scope, 'data-language') ||
    firstText(scope, '[data-language]') ||
    firstText(scope, '.language-label') ||
    headerLabel(scope) ||
    '';

  const cleaned = normaliseLanguage(declared);
  if (cleaned) return cleaned;

  return sniffCodeLanguage(code ? code.textContent : '');
}

/**
 * Reduce a raw label to a language, or '' if it is not one.
 * @param {string} raw
 * @returns {string}
 */
function normaliseLanguage(raw) {
  const cleaned = String(raw || '').trim().toLowerCase();
  if (!cleaned || CODE_HEADER_NOISE.has(cleaned)) return '';
  // A label is one token; anything with whitespace in it is header prose.
  if (/\s/.test(cleaned)) return '';
  if (!/^[a-z0-9+#._-]{1,20}$/.test(cleaned)) return '';
  return LANGUAGE_ALIASES[cleaned] || cleaned;
}

/**
 * Pull a language out of a code block's header strip.
 *
 * A header is presentational: it carries the language plus button captions
 * ("bash Copy Edit"), and sometimes carries no language at all, only UI prose
 * ("Always show details" on ChatGPT's analysis blocks). Prefer the first leaf
 * node that reduces to a single non-control token — the label is its own
 * element, and reading the whole header's text is what let "Copy" through.
 *
 * @param {Element} pre
 * @returns {string}
 */
function headerLabel(pre) {
  if (!pre || typeof pre.querySelector !== 'function') return '';
  const header = pre.querySelector('[class*="sticky"], header, [class*="header"]');
  if (!header) return '';

  // The label node first: a leaf whose whole text is one non-control word.
  const leaves = Array.from(header.querySelectorAll('*'))
    .filter(el => el.children.length === 0 && (el.textContent || '').trim());
  for (const leaf of leaves) {
    const token = normaliseLanguage(leaf.textContent);
    if (token) return token;
  }

  // Otherwise the header as a whole, but only if one word survives the noise
  // filter. Two or more leftover words is prose, and taking the first yields
  // nonsense like "always".
  const tokens = (header.textContent || '')
    .trim()
    .split(/[\s\n\r\t]+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t && !CODE_HEADER_NOISE.has(t));
  return tokens.length === 1 ? normaliseLanguage(tokens[0]) : '';
}

/**
 * Infer a language from the code itself.
 *
 * Deliberately narrow. A wrong label is worse than none: it picks a wrong file
 * extension and asserts something untrue about the content, and nothing
 * downstream can tell a guess from a read label. So this only fires on
 * evidence that is close to proof — a shebang, a body that actually parses as
 * JSON, unified-diff markers — or on structural markers strong enough that a
 * false positive would need code deliberately written to look like another
 * language. Anything ambiguous returns '' and stays unlabelled.
 *
 * @param {string} text
 * @returns {string}
 */
function sniffCodeLanguage(text) {
  const body = String(text || '');
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const first = lines[0];

  // A shebang states the interpreter outright.
  const shebang = first.match(/^#!\s*(?:\S*\/env\s+)?(\S+)/);
  if (shebang) {
    const interp = shebang[1].split(/[\\/]/).pop().replace(/[0-9.]+$/, '').toLowerCase();
    if (SHEBANG_LANGUAGES[interp]) return SHEBANG_LANGUAGES[interp];
  }

  // Parsing is proof, not a guess. Guarded by a cheap shape check so a large
  // non-JSON block is not handed to the parser.
  if (/^[{[]/.test(first) && /[}\]]$/.test(lines[lines.length - 1])) {
    try {
      JSON.parse(body);
      return 'json';
    } catch (e) { /* not JSON — fall through */ }
  }

  if (/^(diff --git |index [0-9a-f]{7,}|--- |\+\+\+ )/.test(first) ||
      lines.some(l => /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(l))) {
    return 'diff';
  }

  if (/^<(!doctype\s+html|html[\s>])/i.test(first)) return 'html';

  if (/^\s*select\b[\s\S]*\bfrom\b/i.test(body) &&
      /;\s*$/.test(body.trim())) {
    return 'sql';
  }

  // Structural markers, each of which would be a syntax error in the languages
  // it is being distinguished from.
  if (lines.some(l => /^(def|class)\s+[A-Za-z_]\w*\s*[(:]/.test(l)) ||
      lines.some(l => /^from\s+[\w.]+\s+import\s+/.test(l)) ||
      lines.some(l => /^import\s+[\w.]+$/.test(l) && !/;/.test(l))) {
    return 'python';
  }

  // PowerShell: `param(` opening a script, or two or more Verb-Noun cmdlets.
  const cmdlets = (body.match(/\b(?:Get|Set|New|Remove|Write|Test|Start|Stop|Add|Select|Where|ForEach|Invoke|Import|Export|Register|Unregister|Copy|Move|Join|Split|Convert|Out)-[A-Z][A-Za-z]+\b/g) || []);
  if (/^param\s*\(/im.test(body) || cmdlets.length >= 2) return 'powershell';

  return '';
}

/**
 * Extract text content from an element, preserving code blocks.
 * @param {Element} element
 * @returns {string}
 */
function extractTextContent(element) {
  if (!element) return '';

  // Clone to avoid modifying the DOM
  const clone = element.cloneNode(true);

  // Strip non-content nodes that otherwise bleed into textContent. Claude's
  // animated web-search "Research complete" widget injects <style> keyframes
  // inside the message subtree, which would land in the extracted text (#206).
  clone.querySelectorAll('style, script').forEach(el => el.remove());

  // Process code blocks - preserve with markdown formatting
  const codeBlocks = clone.querySelectorAll(SELECTORS.codeBlock);
  codeBlocks.forEach(code => {
    // Replace the OUTER block, not the inner CodeMirror pre. Replacing the
    // inner one leaves the outer block's chrome behind, so the "Copy" button's
    // caption lands in the extracted text next to the fence.
    //
    // A block matches the selector twice (once as pre.cm-content, once as the
    // <code> inside it). The first replacement detaches the second, and
    // replaceWith on a node with no parent is a no-op, so the fence is still
    // emitted exactly once — asserted in tests/code-language.test.js rather
    // than assumed.
    const pre = outermostPre(code) || code;
    const lang = detectCodeLanguage(code, pre);
    const codeText = code.textContent;
    const replacement = document.createTextNode(`\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`);
    pre.replaceWith(replacement);
  });

  return clone.textContent.trim();
}

/**
 * Extract thinking content from an assistant message.
 * @param {Element} element
 * @returns {string|null}
 */
function extractThinking(element) {
  const thinkingEl = element.querySelector(SELECTORS.thinkingContent);
  if (thinkingEl) {
    return extractTextContent(thinkingEl);
  }
  return null;
}

/**
 * Favicon services, as URL tests (#279).
 *
 * The backstop half of the decoration test. The role half — SELECTORS
 * .citationDecoration — is the one that survives a provider swap, but it is
 * only defined where the citation markup has actually been verified, and it
 * cannot catch a favicon rendered outside a citation affordance. Between them:
 * a known favicon host is dropped on every site, and an unknown provider is
 * still dropped wherever the citation container is known.
 *
 * Deliberately a closed list of favicon SERVICES rather than a size or an
 * `alt=""` heuristic. "Small image with no alt text" describes a favicon and
 * also describes an inline diagram a user pasted, and the cost of confusing
 * them is a silently missing image — the failure this whole batch is about.
 */
const FAVICON_URL_TESTS = [
  /\/s2\/favicons\b/i,          // https://www.google.com/s2/favicons?domain=…
  /\/s2\/u\/\d+\/favicons\b/i,  // signed-in variant of the same service
  /\/faviconV2\b/i,             // https://t*.gstatic.com/faviconV2?url=…
  /^https?:\/\/icons\.duckduckgo\.com\//i,
  /^https?:\/\/[^/]*\/favicon\.ico(\?|$)/i
];

/**
 * Is this <img> decoration for a cited source rather than conversation content?
 *
 * Decoration is not fetched and is not recorded as an attachment: it carries no
 * information the transcript does not already hold in the citation URL, and
 * fetching it cross-origin from an extension context cannot succeed.
 *
 * @param {Element} img
 * @returns {boolean}
 */
function isCitationDecoration(img) {
  const src = img.getAttribute('src') || img.src || '';
  if (src && FAVICON_URL_TESTS.some(re => re.test(src))) return true;

  // closest() is missing on some jsdom-constructed nodes and on SVG image
  // elements; a decoration test that throws would fail the whole extraction,
  // and images fail open by design.
  const roleSel = SELECTORS.citationDecoration;
  if (roleSel && typeof img.closest === 'function') {
    try {
      if (img.closest(roleSel)) return true;
    } catch (e) {
      // A malformed selector must not take the extraction down with it.
    }
  }
  return false;
}

/**
 * Find all images in an element and return their metadata.
 *
 * Citation decoration is excluded here rather than at fetch time so it never
 * becomes an attachment: an attachment list where 152 of 294 entries are
 * favicons more than doubles every count a consumer reads off it (#279).
 *
 * @param {Element} element
 * @param {number} turnIndex
 * @returns {Array<{src: string, turnIndex: number}>}
 */
function findImages(element, turnIndex) {
  const images = element.querySelectorAll(SELECTORS.image);
  return Array.from(images)
    .filter(img => {
      if (!isCitationDecoration(img)) return true;
      DECORATION_SKIPPED++;
      return false;
    })
    .map(img => ({
      src: img.src,
      turnIndex
    }));
}

/**
 * Extract a single user message.
 * @param {Element} element - DOM element containing user message
 * @param {number} index - Turn index
 * @returns {Object} - Turn object
 */
function extractUserTurn(element, index) {
  const images = findImages(element, index);

  return {
    index,
    role: 'user',
    content: extractTextContent(element),
    thinking: null,
    attachments: images.map((img, i) => ({
      type: 'image',
      filename: null, // Will be set during image processing
      originalSrc: img.src
    }))
  };
}

/**
 * Extract a single assistant message including thinking.
 * @param {Element} element - DOM element containing assistant message
 * @param {number} index - Turn index
 * @returns {Object} - Turn object
 */
function extractAssistantTurn(element, index) {
  const thinking = extractThinking(element);
  const images = findImages(element, index);

  // Remove thinking content from main content extraction
  const contentClone = element.cloneNode(true);
  const thinkingEl = contentClone.querySelector(SELECTORS.thinkingContent);
  if (thinkingEl) {
    thinkingEl.remove();
  }

  return {
    index,
    role: 'assistant',
    content: extractTextContent(contentClone),
    thinking,
    attachments: images.map(img => ({
      type: 'image',
      filename: null,
      originalSrc: img.src
    }))
  };
}

/**
 * Strip Claude artifact-widget chrome from a cloned response container.
 *
 * Claude renders interactive artifact cards (email drafts, document drafts,
 * code) inside the assistant response. The card has a distinctive class
 * signature: `font-ui` + `rounded-2xl` + `rounded-t-3xl` + `overflow-hidden`
 * + `border-border-300` — verified 2026-05-23 against a real Recruiter
 * email-draft widget (issue #43).
 *
 * Inside each widget, two kinds of text were leaking into the extracted
 * content:
 *
 *   1. Button labels — variant-selector tabs ("Warm decline, door open" /
 *      "Brief, final close") and action buttons ("Send via Gmail") have
 *      visible text inside `<span>` children, which textContent captures
 *      as if it were prose.
 *   2. Adjacent label+value pairs — a `<label>Subject:</label>` element
 *      next to its value renders as readable "Subject: Re: Your inquiry"
 *      in the UI but textContent concatenates them with no separator:
 *      "Subject:Re: Your inquiry".
 *
 * Fix: remove all `<button>` elements inside any matched widget (none of
 * them are prose), and append a single space inside each `<label>` so the
 * subsequent value reads with proper separation.
 *
 * @param {Element} rootEl - cloned response container to modify in place
 */
function stripArtifactWidgetChrome(rootEl) {
  if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
  const widgetRoots = rootEl.querySelectorAll(
    '.font-ui.rounded-2xl.rounded-t-3xl.overflow-hidden.border-border-300'
  );
  if (!widgetRoots.length) return;
  const doc = rootEl.ownerDocument || document;
  for (const widget of widgetRoots) {
    widget.querySelectorAll('button').forEach(btn => btn.remove());
    widget.querySelectorAll('label').forEach(label => {
      label.appendChild(doc.createTextNode(' '));
    });
  }
}

/**
 * Extract a single Claude assistant turn.
 * Claude uses .row-start-1 for thinking and .row-start-2 for response content.
 * Tool use is indicated by buttons with group/row class inside .row-start-1.
 * @param {Element} element - DOM element containing assistant message (the action-bar-copy ancestor)
 * @param {number} index - Turn index
 * @returns {Object} - Turn object
 */
function extractAssistantTurnClaude(element, index) {
  const images = findImages(element, index);

  // Extract thinking from .row-start-1
  let thinking = null;
  const thinkingEl = element.querySelector(SELECTORS.thinkingContent);
  if (thinkingEl) {
    thinking = extractTextContent(thinkingEl);
  }

  // Extract tool use labels from buttons inside thinking row
  let toolUse = null;
  if (SELECTORS.toolUseButton) {
    const toolButtons = element.querySelectorAll(SELECTORS.toolUseButton);
    if (toolButtons.length > 0) {
      toolUse = Array.from(toolButtons).map(btn => btn.textContent.trim());
    }
  }

  // Extract content by cloning the turn container and removing only OUTER
  // .row-start-1 subtrees (the thinking-title rows). Preserve any
  // .row-start-1 nested INSIDE a .row-start-2 — on real Claude DOM the
  // actual response body for normal turns lives in a nested
  // .row-start-1.col-start-1 element that is a child of the outer
  // .row-start-2. Removing it (as PR #40 did) wiped out every normal
  // response. Issue #39.
  //
  // Real DOM:
  //   font-claude-response
  //     div.row-start-1                     <- OUTER thinking (remove)
  //     div.row-start-2                     <- response wrapper (keep)
  //       div.row-start-1.col-start-1...    <- INNER response body (keep)
  //     [div > div.standard-markdown > p]   <- sibling commentary on
  //                                            artifact turns (keep)
  const contentClone = element.cloneNode(true);
  contentClone.querySelectorAll(SELECTORS.thinkingContent).forEach(el => {
    if (!el.closest(SELECTORS.responseContent)) {
      el.remove();
    }
  });
  stripArtifactWidgetChrome(contentClone);
  const content = extractTextContent(contentClone);

  const turn = {
    index,
    role: 'assistant',
    content,
    thinking,
    toolUse,
    attachments: images.map(img => ({
      type: 'image',
      filename: null,
      originalSrc: img.src
    }))
  };

  // Mark turns whose entire response lived inside the expandable thinking
  // section (empty .row-start-2, non-empty .row-start-1). Lets downstream
  // consumers distinguish "assistant had nothing to say" from "assistant
  // responded only inside the thinking panel".
  const hasContent = !!(content && content.trim());
  const hasThinking = !!(thinking && thinking.trim());
  if (!hasContent && hasThinking) {
    turn.type = 'thinking-only';
  }

  return turn;
}

/**
 * Resolve the per-turn container for a Claude assistant turn given its
 * .row-start-2 response-content element. Walks up from the response element
 * until the parent would include a sibling .row-start-2 (i.e., the parent
 * bridges turns), and returns the last single-turn ancestor.
 *
 * Why this shape: on real Claude DOM each assistant turn has exactly one
 * .row-start-2; its nearest ancestors also have exactly one until we reach
 * the conversation column, which has N (one per turn). The boundary at which
 * the parent's .row-start-2 count flips from 1 to >1 is the per-turn
 * container's outer edge. This keeps extraction scoped to this turn only.
 *
 * @param {Element} responseEl - The .row-start-2 element for this turn
 * @returns {Element} - The per-turn container (includes .row-start-1 + .row-start-2)
 */
function findClaudeAssistantContainer(responseEl) {
  let current = responseEl;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (!parent || parent === document.body) break;
    if (parent.querySelectorAll(SELECTORS.responseContent).length > 1) {
      return current;
    }
    if (parent.querySelector(SELECTORS.userMessage)) {
      return current;
    }
    current = parent;
  }
  return current || responseEl;
}

/**
 * Extract turns from a Claude conversation.
 * User turns are identified by [data-testid="user-message"].
 * Assistant turns are identified by .row-start-2 (response-content row).
 * @returns {Promise<Array>} - Array of turn objects
 */
async function extractTurnsClaude() {
  const turns = [];
  let turnIndex = 0;

  const userMsgs = Array.from(document.querySelectorAll(SELECTORS.userMessage));
  const responseEls = Array.from(document.querySelectorAll(SELECTORS.assistantMessage));

  const allMsgs = [...userMsgs, ...responseEls].sort((a, b) => {
    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  for (let i = 0; i < allMsgs.length; i++) {
    const element = allMsgs[i];
    const isUser = element.matches(SELECTORS.userMessage);

    if (isUser) {
      turns.push(extractUserTurn(element, turnIndex++));
    } else {
      // element IS the per-turn container (.font-claude-response) — no
      // walking-up needed. Pre-2026-05 code used .row-start-2 as the
      // assistant-turn selector and then walked up via
      // findClaudeAssistantContainer to find the bounding turn. With the
      // new selector that step is unnecessary (#114).
      turns.push(extractAssistantTurnClaude(element, turnIndex++));
    }

    if (i > 0 && i % 20 === 0) {
      showProgress(`Extracting turn ${i}/${allMsgs.length}...`);
      await sleep(0);
    }
  }

  return turns;
}

/**
 * Extract a single ChatGPT assistant turn.
 * ChatGPT uses article[data-turn="assistant"] with data-message-author-role inside.
 * Reasoning is shown as "Reasoned about X for Y seconds" label (not expandable content).
 * @param {Element} article - The article element for this assistant turn
 * @param {number} index - Turn index
 * @returns {Object} - Turn object
 */
function extractAssistantTurnChatGPT(messageEl, index) {
  const images = findImages(messageEl, index);

  // Extract reasoning label if present (e.g. "Reasoned about X for Y seconds")
  let thinking = null;
  if (SELECTORS.reasoningLabel) {
    const reasoningEl = messageEl.querySelector(SELECTORS.reasoningLabel);
    if (reasoningEl) {
      const reasonText = reasoningEl.textContent.trim();
      if (reasonText.toLowerCase().includes('reason') || reasonText.toLowerCase().includes('thought')) {
        thinking = reasonText;
      }
    }
  }

  // Extract response content from .markdown container
  const contentSelector = SELECTORS.assistantContent || '.markdown';
  const contentEl = messageEl.querySelector(contentSelector);
  const content = contentEl ? extractTextContent(contentEl) : extractTextContent(messageEl);

  // Extract model slug if available (may be on the messageEl itself or a descendant)
  let modelSlug = messageEl.getAttribute('data-message-model-slug');
  if (!modelSlug) {
    const modelEl = messageEl.querySelector('[data-message-model-slug]');
    if (modelEl) {
      modelSlug = modelEl.getAttribute('data-message-model-slug');
    }
  }

  return {
    index,
    role: 'assistant',
    content,
    thinking,
    modelSlug,
    attachments: images.map(img => ({
      type: 'image',
      filename: null,
      originalSrc: img.src
    }))
  };
}

/**
 * Extract turns from a ChatGPT conversation.
 * ChatGPT uses <article data-turn="user|assistant"> elements.
 * @returns {Promise<Array>} - Array of turn objects
 */
async function extractTurnsChatGPT() {
  const turns = [];
  let turnIndex = 0;

  // Every message seen during the scroll, not just the window still rendered.
  // ChatGPT evicts as it loads, so reading the live DOM here would return one
  // window of a long conversation (#256).
  const messageEls = getCapturedMessageEls();

  for (let i = 0; i < messageEls.length; i++) {
    const messageEl = messageEls[i];
    const turnType = messageEl.getAttribute('data-message-author-role');

    if (turnType === 'user') {
      // Extract user content from .whitespace-pre-wrap or the message element
      const contentSelector = SELECTORS.userContent || '.whitespace-pre-wrap';
      const contentEl = messageEl.querySelector(contentSelector);
      const element = contentEl || messageEl;
      turns.push(extractUserTurn(element, turnIndex++));
    } else if (turnType === 'assistant') {
      turns.push(extractAssistantTurnChatGPT(messageEl, turnIndex++));
    } else {
      continue;
    }

    // Files seen on this message during the scroll (#262). They are merged
    // here rather than inside the per-role extractors because a user turn is
    // extracted from its .whitespace-pre-wrap content element, and the file
    // cards sit outside it — on the message element, which only this loop
    // still holds.
    const messageId = messageEl.getAttribute('data-message-id') ||
                      messageEl.getAttribute('data-turn-id');
    const files = messageId ? getMessageArtifacts(messageId) : [];
    if (files.length) {
      const turn = turns[turns.length - 1];
      turn.attachments = (turn.attachments || []).concat(files);
    }

    if (i > 0 && i % 20 === 0) {
      showProgress(`Extracting turn ${i}/${messageEls.length}...`);
      await sleep(0);
    }
  }

  return turns;
}

/**
 * Extract turns from a Gemini conversation.
 * Gemini uses .conversation-container elements with user-query and model-response inside.
 * @returns {Promise<Array>} - Array of turn objects
 */
async function extractTurnsGemini() {
  const turns = [];
  let turnIndex = 0;

  // Strategy 1: Find conversation containers (Gemini's structure)
  // Each container has a user-query and model-response inside
  const containers = document.querySelectorAll('.conversation-container');

  if (containers.length > 0) {
    for (const container of containers) {
      const userEl = container.querySelector('user-query, [data-message-author-role="user"]');
      if (userEl) {
        turns.push(extractUserTurn(userEl, turnIndex++));
      }

      const assistantEl = container.querySelector('model-response, [data-message-author-role="model"]');
      if (assistantEl) {
        turns.push(extractAssistantTurn(assistantEl, turnIndex++));
      }

      if (turnIndex % 20 === 0) {
        showProgress(`Extracting turn ${turnIndex}...`);
        await sleep(0);
      }
    }

    return turns;
  }

  // Strategy 2: Fallback - find user and assistant messages directly
  const userMsgs = Array.from(document.querySelectorAll(SELECTORS.userMessage));
  const assistantMsgs = Array.from(document.querySelectorAll(SELECTORS.assistantMessage));

  const allMsgs = [...userMsgs, ...assistantMsgs].sort((a, b) => {
    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  const BATCH_SIZE = 20;

  for (let i = 0; i < allMsgs.length; i++) {
    const element = allMsgs[i];
    const isUser = element.matches('user-query') ||
                   element.matches(SELECTORS.userMessage) ||
                   element.getAttribute('data-message-author-role') === 'user';

    if (isUser) {
      turns.push(extractUserTurn(element, turnIndex++));
    } else {
      turns.push(extractAssistantTurn(element, turnIndex++));
    }

    if (i > 0 && i % BATCH_SIZE === 0) {
      showProgress(`Extracting turn ${i}/${allMsgs.length}...`);
      await sleep(0);
    }
  }

  return turns;
}

/**
 * Find and extract all conversation turns in DOM order.
 * Dispatches to site-specific extraction based on SELECTORS.site.
 * @returns {Promise<Array>} - Array of turn objects
 */
async function extractTurns() {
  const site = getSite();
  if (site === 'claude') {
    return extractTurnsClaude();
  }
  if (site === 'chatgpt') {
    return extractTurnsChatGPT();
  }
  return extractTurnsGemini();
}

// ============================================================================
// Image Extraction
// ============================================================================

/**
 * Determine image extension from MIME type or URL.
 * @param {string} mimeType
 * @param {string} url
 * @returns {string}
 */
function getImageExtension(mimeType, url) {
  if (mimeType) {
    const ext = mimeType.split('/')[1];
    if (ext) return ext.replace('jpeg', 'jpg');
  }
  // Try to extract from URL
  const match = url.match(/\.([a-z]{3,4})(?:\?|$)/i);
  if (match) return match[1].toLowerCase();
  return 'png'; // Default
}

/**
 * Fetch a single image, handling different URL schemes.
 * @param {string} src - Image source URL
 * @param {number} turnIndex - Which turn this image belongs to
 * @param {number} imageIndex - Image sequence number
 * @returns {Promise<Object>} - ImageData or error object
 */
async function fetchImage(src, turnIndex, imageIndex) {
  const timestamp = new Date().toISOString();

  try {
    // Handle data URLs
    if (src.startsWith('data:')) {
      const match = src.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return {
          type: 'image_fetch',
          message: 'Invalid data URL format',
          turnIndex,
          originalSrc: src,
          timestamp
        };
      }
      const mimeType = match[1];
      const base64Data = match[2];
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      const ext = getImageExtension(mimeType, src);
      const filename = `images/${String(imageIndex).padStart(3, '0')}.${ext}`;

      return {
        blob,
        filename,
        originalSrc: src,
        turnIndex
      };
    }

    // Handle blob URLs and https URLs
    const response = await fetch(src, {
      credentials: 'include' // For googleusercontent.com
    });

    if (!response.ok) {
      return {
        type: 'image_fetch',
        message: `HTTP ${response.status}: ${response.statusText}`,
        turnIndex,
        originalSrc: src,
        timestamp
      };
    }

    const blob = await response.blob();
    const ext = getImageExtension(blob.type, src);
    const filename = `images/${String(imageIndex).padStart(3, '0')}.${ext}`;

    return {
      blob,
      filename,
      originalSrc: src,
      turnIndex
    };

  } catch (error) {
    return {
      type: 'image_fetch',
      message: error.message || 'Unknown fetch error',
      turnIndex,
      originalSrc: src,
      timestamp
    };
  }
}

/**
 * Extract all images from turns, fetch as blobs.
 * Supports blob:, data:, and https: URLs.
 * Logs detailed errors for failed fetches (Fail Open).
 * @param {Array} turns - Array of turn objects
 * @returns {Promise<{images: Array, errors: Array}>}
 */
async function extractImages(turns) {
  const images = [];
  const errors = [];
  let imageIndex = 1;

  // Collect all image sources from turns
  const imageSources = [];
  turns.forEach(turn => {
    turn.attachments.forEach(att => {
      if (att.type === 'image' && att.originalSrc) {
        imageSources.push({
          src: att.originalSrc,
          turnIndex: turn.index,
          attachment: att
        });
      }
    });
  });

  // Fetch images in parallel batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < imageSources.length; i += BATCH_SIZE) {
    const batch = imageSources.slice(i, i + BATCH_SIZE);

    showProgress(`Processing images ${i + 1}-${Math.min(i + BATCH_SIZE, imageSources.length)} of ${imageSources.length}...`);

    const results = await Promise.all(
      batch.map((item, batchIdx) =>
        fetchImage(item.src, item.turnIndex, imageIndex + batchIdx)
      )
    );

    results.forEach((result, batchIdx) => {
      const item = batch[batchIdx];

      if (result.blob) {
        // Success
        images.push(result);
        item.attachment.filename = result.filename;
        imageIndex++;
      } else {
        // Error - Fail Open
        errors.push(result);
        item.attachment.error = result.message;
        imageIndex++;
      }
    });
  }

  return { images, errors };
}

// ============================================================================
// Main Extraction
// ============================================================================

/**
 * Main extraction entry point. Checks state, expands content, extracts data.
 * @returns {Promise<Object>} - ExtractionResult
 */
async function extractConversation() {
  try {
    // Phase 0: Pre-flight checks
    const siteNames = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' };
    const siteName = siteNames[getSite()] || 'Unknown';

    if (isStreaming()) {
      return {
        success: false,
        error: `${siteName} is currently generating a response. Please wait for completion before extracting.`
      };
    }

    const validation = validateSelectors();
    if (!validation.valid) {
      return {
        success: false,
        error: `${siteName} UI may have changed. Missing selectors: ${validation.missing.join(', ')}. Please report this issue.`
      };
    }

    // Phase 1: Auto-scroll to load all messages (for lazy-loaded conversations)
    showProgress('Loading conversation history...');
    const scrollResult = await scrollToLoadAllMessages();

    // Phase 2: Expand content
    showProgress('Expanding content...');
    const expandedCount = await expandAllContent();
    await sleep(500); // Wait for expansions to settle

    // Phase 3: Extract metadata
    showProgress('Extracting metadata...');
    const conversationId = extractConversationId();
    const title = extractTitle();
    const url = window.location.href;
    const extractedAt = new Date().toISOString();

    // Phase 4: Extract turns
    showProgress('Extracting conversation...');
    resetDecorationCount();
    const rawTurns = await extractTurns();
    // Drop blank turns — thinking-only / artifact-only shells that produce an
    // empty-content message (#208); re-index so positions stay contiguous.
    const turns = rawTurns
      .filter(t =>
        (t.content && t.content.trim()) ||
        (t.thinking && String(t.thinking).trim()) ||
        (t.attachments && t.attachments.length) ||
        (t.toolUse && t.toolUse.length))
      .map((t, i) => ({ ...t, index: i }));

    // Phase 5: Extract images (Fail Open)
    const { images, errors } = await extractImages(turns);

    // How the transcript was ordered, and how well (#264). A scrambled export
    // looks complete and passes a size check, so the confidence in the order
    // travels with the data rather than being asserted in a log line nobody
    // reads. A non-zero withoutOrderKey is the tell that ordering degraded.
    const orderStats = getCaptureOrderStats();
    const fileAttachments = turns.reduce((n, t) => n +
      (t.attachments || []).filter(a => a.type === 'file' || a.type === 'artifact').length, 0);

    // Collect warnings
    const warnings = [];
    if (scrollResult.warning) {
      warnings.push(scrollResult.warning);
    }
    if (errors.length > 0) {
      warnings.push(`${errors.length} image(s) failed to download`);
    }
    // Only where the export's order actually comes from the capture cache
    // (#272). The shared scroll path populates the cache on every site, but
    // Gemini and Claude read turns from the live DOM and never consult it — so
    // a complaint about the cache's ordering would be describing something that
    // did not affect their export at all. A check that cries wolf on the
    // most-used path is worse than no check.
    const ordersFromCapture = !!SELECTORS.ordersFromCapture;
    if (ordersFromCapture && orderStats.withoutOrderKey > 0) {
      warnings.push(
        `${orderStats.withoutOrderKey} message(s) could not be positioned and were appended in capture order`);
    }

    // Build result
    const data = {
      metadata: {
        conversationId,
        title,
        extractedAt,
        url,
        messageCount: turns.length,
        imageCount: images.length,
        fileCount: fileAttachments,
        // What was deliberately not fetched, so the drop is auditable and a
        // regression in the decoration test is visible as a number moving
        // rather than as images quietly going missing (#279).
        decorationSkipped: getDecorationCount(),
        extractionErrors: errors,
        partialSuccess: errors.length > 0 || !!scrollResult.warning ||
                        (ordersFromCapture && orderStats.withoutOrderKey > 0),
        scrollInfo: {
          messagesLoaded: scrollResult.messagesLoaded,
          scrollAttempts: scrollResult.scrollAttempts
        }
      },
      messages: turns
    };

    // Present only where it describes this export, rather than always present
    // and meaningless on two sites out of three (#272).
    if (ordersFromCapture) {
      data.metadata.orderInfo = {
        orderedBy: 'distance from the scroller bottom, measured at capture time',
        capturedMessages: orderStats.captured,
        withOrderKey: orderStats.withOrderKey,
        withoutOrderKey: orderStats.withoutOrderKey,
        neverMeasuredOnSettledDom: orderStats.neverMeasuredOnSettledDom
      };
    }

    hideProgress();

    // Extraction complete - all info available in metadata, no console output

    return {
      success: true,
      data,
      images,
      warnings
    };

  } catch (error) {
    hideProgress();
    return {
      success: false,
      error: `Extraction failed: ${error.message}`
    };
  }
}

// ============================================================================
// Message Handling
// ============================================================================

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    extractConversation().then(result => {
      // Convert blobs to base64 for message passing
      if (result.images && result.images.length > 0) {
        Promise.all(result.images.map(async img => {
          const reader = new FileReader();
          return new Promise((resolve) => {
            reader.onload = () => {
              resolve({
                ...img,
                dataUrl: reader.result,
                blob: undefined // Can't send blob via message
              });
            };
            reader.readAsDataURL(img.blob);
          });
        })).then(imagesWithData => {
          result.images = imagesWithData;
          sendResponse(result);
        });
      } else {
        sendResponse(result);
      }
    });
    return true; // Keep channel open for async response
  }
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getSite,
    sanitizeFilename,
    extractTitle,
    extractConversationId,
    extractTextContent,
    detectCodeLanguage,
    sniffCodeLanguage,
    outermostPre,
    extractUserTurn,
    extractAssistantTurn,
    extractAssistantTurnClaude,
    extractAssistantTurnChatGPT,
    extractTurns,
    extractTurnsClaude,
    extractTurnsGemini,
    extractTurnsChatGPT,
    validateSelectors,
    isStreaming,
    expandAllContent,
    extractImages,
    // Citation decoration (#279)
    findImages,
    isCitationDecoration,
    resetDecorationCount,
    getDecorationCount,
    extractConversation,
    // Auto-scroll exports
    SCROLL_CONFIG,
    setScrollConfig,
    resetScrollConfig,
    countMessages,
    isRealScroller,
    findScrollContainer,
    waitForLoadingComplete,
    scrollToLoadAllMessages,
    // Virtualized-list capture (#256) and bottom-anchored ordering (#264)
    captureRenderedMessages,
    remeasureRenderedMessages,
    getCapturedMessageEls,
    getCaptureOrderStats,
    resetMessageCache,
    setMessageScroller,
    measureFromBottom,
    // Attached-file capture during the scroll (#262)
    captureMessageArtifacts,
    getMessageArtifacts,
    elementTextLines
  };
}
