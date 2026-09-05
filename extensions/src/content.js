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
 * @type {Map<string, {el: Element, turn: number, seq: number}>}
 */
let MESSAGE_CACHE = new Map();

/**
 * Global conversation order, rebuilt by stitching overlapping windows (#264).
 * @type {string[]}
 */
let MESSAGE_ORDER = [];

/**
 * Splice one rendered window's ids into the global order.
 *
 * DOM order WITHIN a window is reliable; the wrapper's
 * data-testid="conversation-turn-N" is NOT — it is numbered relative to the
 * window, and took only 14 distinct values across 155 real messages, so sorting
 * on it scrambles the transcript. What makes stitching sound is that
 * consecutive windows overlap, so already-placed ids act as anchors.
 *
 * @param {string[]} windowIds ids in DOM order, as currently rendered
 */
function stitchMessageOrder(windowIds) {
  const pos = new Map(MESSAGE_ORDER.map((id, i) => [id, i]));
  for (let i = 0; i < windowIds.length; i++) {
    const id = windowIds[i];
    if (pos.has(id)) continue;

    let at = -1;
    // Nearest already-placed id AFTER this one: it belongs immediately before.
    for (let j = i + 1; j < windowIds.length; j++) {
      if (pos.has(windowIds[j])) { at = pos.get(windowIds[j]); break; }
    }
    if (at === -1) {
      // Else the nearest already-placed id BEFORE it.
      for (let j = i - 1; j >= 0; j--) {
        if (pos.has(windowIds[j])) { at = pos.get(windowIds[j]) + 1; break; }
      }
    }
    if (at === -1) at = MESSAGE_ORDER.length;   // the first window seen

    MESSAGE_ORDER.splice(at, 0, id);
    for (let k = at; k < MESSAGE_ORDER.length; k++) pos.set(MESSAGE_ORDER[k], k);
  }
}

/**
 * Snapshot every message currently rendered that we have not already kept, and
 * record where this window sits in the conversation.
 * Cheap and idempotent — safe to call on every scroll tick and every mutation.
 * @returns {number} how many new messages were captured
 */
function captureRenderedMessages() {
  let added = 0;
  const nodes = Array.from(document.querySelectorAll(SELECTORS.allMessages));
  const ids = [];
  for (const el of nodes) {
    const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id');
    if (!id) continue;
    ids.push(id);
    if (MESSAGE_CACHE.has(id)) continue;
    MESSAGE_CACHE.set(id, el.cloneNode(true));
    added++;
  }
  stitchMessageOrder(ids);
  return added;
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
  const out = [];
  const seen = new Set();
  for (const id of MESSAGE_ORDER) {
    const el = MESSAGE_CACHE.get(id);
    if (el && !seen.has(id)) { seen.add(id); out.push(el); }
  }
  // Anything the stitcher never placed is appended rather than dropped — a
  // capture that cannot be ordered must still not go missing.
  for (const [id, el] of MESSAGE_CACHE) if (!seen.has(id)) out.push(el);
  return out;
}

/** Drop the cache (called at the start of each scroll, and by tests). */
function resetMessageCache() {
  MESSAGE_CACHE = new Map();
  MESSAGE_ORDER = [];
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

/**
 * Best available language label for a code block.
 *
 * Order matters. The `language-*` class on <code> is the highlighter
 * convention and is by far the most reliable; the header label is a fallback
 * because it is presentational and carries button captions. Reading only the
 * header is why 563 of 636 blocks came back unlabelled on a real conversation
 * (#263).
 *
 * @param {Element} code - the <code> (or CodeMirror content) element
 * @param {Element} pre  - its enclosing <pre>
 * @returns {string} the language, lowercased, or '' when unknown
 */
function detectCodeLanguage(code, pre) {
  const fromClass = (el) => {
    if (!el || !el.classList) return '';
    for (const cls of el.classList) {
      const m = cls.match(/^(?:language|lang|highlight)[-_](.+)$/i);
      if (m && m[1]) return m[1];
    }
    return '';
  };

  const candidate =
    fromClass(code) ||
    fromClass(pre) ||
    code.getAttribute('data-language') ||
    (code.dataset && code.dataset.language) ||
    pre.getAttribute('data-language') ||
    (pre.querySelector('[data-language]') &&
      pre.querySelector('[data-language]').getAttribute('data-language')) ||
    (pre.querySelector('.language-label') && pre.querySelector('.language-label').textContent) ||
    headerLabel(pre) ||
    '';

  const cleaned = String(candidate).trim().toLowerCase();
  if (!cleaned || CODE_HEADER_NOISE.has(cleaned)) return '';
  // A label should be a single token; anything longer is header prose.
  if (/\s/.test(cleaned)) return '';
  return cleaned;
}

/**
 * Pull a language out of a code block's header strip.
 *
 * A header is presentational: it carries the language plus button captions
 * ("bash Copy Edit"), and sometimes carries no language at all, only UI prose
 * ("Always show details" on ChatGPT's analysis blocks). Strip the known control
 * words; what remains is a language ONLY if it is a single token. Two or more
 * leftover words is prose, and taking the first of them yields nonsense like
 * "always".
 *
 * @param {Element} pre
 * @returns {string}
 */
function headerLabel(pre) {
  const header = pre.querySelector('[class*="sticky"], header, [class*="header"]');
  if (!header) return '';
  const tokens = (header.textContent || '')
    .trim()
    .split(/[\s\n\r\t]+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t && !CODE_HEADER_NOISE.has(t));
  return tokens.length === 1 ? tokens[0] : '';
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
    const pre = code.closest('pre') || code;
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
 * Find all images in an element and return their metadata.
 * @param {Element} element
 * @param {number} turnIndex
 * @returns {Array<{src: string, turnIndex: number}>}
 */
function findImages(element, turnIndex) {
  const images = element.querySelectorAll(SELECTORS.image);
  return Array.from(images).map(img => ({
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

    // Collect warnings
    const warnings = [];
    if (scrollResult.warning) {
      warnings.push(scrollResult.warning);
    }
    if (errors.length > 0) {
      warnings.push(`${errors.length} image(s) failed to download`);
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
        extractionErrors: errors,
        partialSuccess: errors.length > 0 || !!scrollResult.warning,
        scrollInfo: {
          messagesLoaded: scrollResult.messagesLoaded,
          scrollAttempts: scrollResult.scrollAttempts
        }
      },
      messages: turns
    };

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
    // Virtualized-list capture (#256) and window stitching (#264)
    captureRenderedMessages,
    getCapturedMessageEls,
    resetMessageCache,
    stitchMessageOrder
  };
}
