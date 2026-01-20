/**
 * Content script for Clio.
 * Handles DOM extraction of conversation data.
 *
 * LLD Reference: docs/reports/1/lld-clio.md
 */

/* global SELECTORS, chrome */

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
      top: 20px;
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
    console.warn('No conversation container found, skipping expansion');
    return 0;
  }

  // Find expand buttons ONLY within the conversation container
  const expandButtons = container.querySelectorAll(SELECTORS.expandButton);
  for (const button of expandButtons) {
    // Safety check: skip menu triggers and global UI buttons
    // These have aria-haspopup or specific menu classes
    if (button.matches('[aria-haspopup="true"], [aria-haspopup="menu"], .mat-menu-trigger, .mat-mdc-menu-trigger')) {
      console.log('Skipping menu button:', button);
      continue;
    }
    try {
      button.click();
      expandedCount++;
      await sleep(300); // Wait for content to expand
    } catch (e) {
      console.warn('Failed to expand element:', e);
    }
  }

  // Find thinking toggles ONLY within the conversation container
  const thinkingToggles = container.querySelectorAll(SELECTORS.thinkingToggle);
  for (const toggle of thinkingToggles) {
    // Safety check: skip if it's a menu trigger
    if (toggle.matches('[aria-haspopup="true"], [aria-haspopup="menu"], .mat-menu-trigger, .mat-mdc-menu-trigger')) {
      console.log('Skipping menu in thinking area:', toggle);
      continue;
    }
    try {
      toggle.click();
      expandedCount++;
      await sleep(300); // Wait for content to expand
    } catch (e) {
      console.warn('Failed to expand thinking:', e);
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
  scrollDelay: 2000,            // Fallback wait when no loading indicator
  loadingAppearDelay: 300,      // Wait for loading indicator to appear after scroll
  mutationTimeout: 3000,        // Wait up to 3s for DOM changes after reaching top
  maxScrollAttempts: 100,       // Reduced - should need far fewer scrolls now
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
  const messages = document.querySelectorAll(SELECTORS.allMessages);
  if (messages.length > 0) return messages.length;

  // Fallback: count user + assistant messages
  const userMsgs = document.querySelectorAll(SELECTORS.userMessage);
  const assistantMsgs = document.querySelectorAll(SELECTORS.assistantMessage);
  return userMsgs.length + assistantMsgs.length;
}

/**
 * Find the scrollable container for the conversation.
 * @returns {Element|null} - The scroll container element
 */
function findScrollContainer() {
  // Try scroll container selector first
  const container = document.querySelector(SELECTORS.scrollContainer);
  if (container && container.scrollHeight > container.clientHeight) {
    return container;
  }

  // Fallback: find the first scrollable ancestor of conversation content
  const conversationContainer = document.querySelector(SELECTORS.conversationContainer);
  if (!conversationContainer) return null;

  let element = conversationContainer;
  while (element && element !== document.body) {
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') &&
        element.scrollHeight > element.clientHeight) {
      return element;
    }
    element = element.parentElement;
  }

  // Last resort: use document.documentElement or body
  if (document.documentElement.scrollHeight > document.documentElement.clientHeight) {
    return document.documentElement;
  }

  return document.body;
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
  let mutationDetected = false;
  const observer = new MutationObserver((mutations) => {
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

  // Logging helper
  const logScroll = (msg, data = {}) => {
    console.log(`%c[Clio Scroll #${scrollAttempts}]`, 'color: #2196F3; font-weight: bold;', msg, data);
  };

  try {
    while (scrollAttempts < SCROLL_CONFIG.maxScrollAttempts) {
      scrollAttempts++;
      mutationDetected = false;

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
      const loadingBefore = !!document.querySelector(SELECTORS.loadingIndicator);

      // If loading indicator is visible, wait for it to disappear
      // This ensures we wait for the full batch to load
      if (loadingBefore) {
        await waitForLoadingComplete();
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
          const finalCount = countMessages();
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
  const finalCount = countMessages();
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
  const titleEl = document.querySelector(SELECTORS.sessionTitle);
  if (titleEl) {
    return titleEl.textContent.trim();
  }
  // Fallback: use document title
  return document.title.replace(' - Gemini', '').trim() || 'Untitled Conversation';
}

/**
 * Extract conversation ID from URL.
 * @returns {string}
 */
function extractConversationId() {
  const match = window.location.pathname.match(/\/app\/([a-f0-9]+)/i);
  return match ? match[1] : 'unknown';
}

// ============================================================================
// Turn Extraction
// ============================================================================

/**
 * Extract text content from an element, preserving code blocks.
 * @param {Element} element
 * @returns {string}
 */
function extractTextContent(element) {
  if (!element) return '';

  // Clone to avoid modifying the DOM
  const clone = element.cloneNode(true);

  // Process code blocks - preserve with markdown formatting
  const codeBlocks = clone.querySelectorAll(SELECTORS.codeBlock);
  codeBlocks.forEach(code => {
    const pre = code.closest('pre') || code;
    // Try to get language from data attribute on code element first, then parent
    const lang = code.getAttribute('data-language') ||
                 code.dataset?.language ||
                 pre.getAttribute('data-language') ||
                 pre.querySelector('[data-language]')?.getAttribute('data-language') ||
                 pre.querySelector('.language-label')?.textContent ||
                 '';
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
 * Find and extract all conversation turns in DOM order.
 * Handles Gemini's DOM structure where each .conversation-container
 * contains both user-query and model-response elements.
 * @returns {Promise<Array>} - Array of turn objects
 */
async function extractTurns() {
  const turns = [];
  let turnIndex = 0;

  // Strategy 1: Find conversation containers (Gemini's structure)
  // Each container has a user-query and model-response inside
  const containers = document.querySelectorAll('.conversation-container');

  if (containers.length > 0) {
    console.log(`[Clio] Found ${containers.length} conversation containers`);

    for (const container of containers) {
      // Extract user message from within this container
      const userEl = container.querySelector('user-query, [data-message-author-role="user"]');
      if (userEl) {
        turns.push(extractUserTurn(userEl, turnIndex++));
      }

      // Extract assistant message from within this container
      const assistantEl = container.querySelector('model-response, [data-message-author-role="model"]');
      if (assistantEl) {
        turns.push(extractAssistantTurn(assistantEl, turnIndex++));
      }

      // Progress update
      if (turnIndex % 20 === 0) {
        showProgress(`Extracting turn ${turnIndex}...`);
        await sleep(0);
      }
    }

    return turns;
  }

  // Strategy 2: Fallback - find user and assistant messages directly
  // and sort them by DOM position
  console.log('[Clio] No conversation containers, using fallback extraction');

  const userMsgs = Array.from(document.querySelectorAll(SELECTORS.userMessage));
  const assistantMsgs = Array.from(document.querySelectorAll(SELECTORS.assistantMessage));

  // Combine and sort by DOM position
  const allMsgs = [...userMsgs, ...assistantMsgs].sort((a, b) => {
    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  console.log(`[Clio] Found ${userMsgs.length} user messages, ${assistantMsgs.length} assistant messages`);

  const BATCH_SIZE = 20;

  for (let i = 0; i < allMsgs.length; i++) {
    const element = allMsgs[i];

    // Determine role
    const isUser = element.matches('user-query') ||
                   element.matches(SELECTORS.userMessage) ||
                   element.getAttribute('data-message-author-role') === 'user';

    if (isUser) {
      turns.push(extractUserTurn(element, turnIndex++));
    } else {
      turns.push(extractAssistantTurn(element, turnIndex++));
    }

    // Yield to event loop every BATCH_SIZE messages
    if (i > 0 && i % BATCH_SIZE === 0) {
      showProgress(`Extracting turn ${i}/${allMsgs.length}...`);
      await sleep(0);
    }
  }

  return turns;
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
    if (isStreaming()) {
      return {
        success: false,
        error: 'Gemini is currently generating a response. Please wait for completion before extracting.'
      };
    }

    const validation = validateSelectors();
    if (!validation.valid) {
      return {
        success: false,
        error: `Gemini UI may have changed. Missing selectors: ${validation.missing.join(', ')}. Please report this issue.`
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
    const turns = await extractTurns();

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

    // Log extraction summary to console
    console.group('%c[Clio] Extraction Complete', 'color: #4CAF50; font-weight: bold; font-size: 14px;');
    console.log('%cConversation:', 'font-weight: bold;', title || 'Untitled');
    console.log('%cMessages extracted:', 'font-weight: bold;', turns.length);
    console.log('%cImages extracted:', 'font-weight: bold;', images.length);
    console.log('%cScroll attempts:', 'font-weight: bold;', scrollResult.scrollAttempts);
    console.log('%cMessages loaded:', 'font-weight: bold;', scrollResult.messagesLoaded);
    console.log('%cExpanded elements:', 'font-weight: bold;', expandedCount);
    if (errors.length > 0) {
      console.warn('%cImage errors:', 'font-weight: bold; color: #FF9800;', errors.length);
      console.table(errors.map((e, i) => ({ index: i + 1, error: e })));
    }
    if (warnings.length > 0) {
      console.warn('%cWarnings:', 'font-weight: bold; color: #FF9800;', warnings);
    }
    console.log('%cScroll config used:', 'font-weight: bold;', SCROLL_CONFIG);
    console.groupEnd();

    return {
      success: true,
      data,
      images,
      warnings
    };

  } catch (error) {
    hideProgress();
    console.error('%c[Clio] Extraction Failed', 'color: #F44336; font-weight: bold; font-size: 14px;', error);
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
    sanitizeFilename,
    extractTitle,
    extractConversationId,
    extractTextContent,
    extractUserTurn,
    extractAssistantTurn,
    extractTurns,
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
    findScrollContainer,
    waitForLoadingComplete,
    scrollToLoadAllMessages
  };
}
