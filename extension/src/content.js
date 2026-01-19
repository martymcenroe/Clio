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
// Auto-Scroll to Load All Messages
// ============================================================================

/**
 * Configuration for auto-scroll behavior.
 */
const SCROLL_CONFIG = {
  scrollStep: 500,           // Pixels to scroll per step
  scrollDelay: 150,          // Ms to wait between scroll steps
  stabilityDelay: 500,       // Ms to wait for content to stabilize
  stabilityChecks: 3,        // Number of stable checks before considering done
  maxScrollAttempts: 1000,   // Safety limit to prevent infinite loops
  progressUpdateInterval: 10 // Update progress every N scroll steps
};

/**
 * Count current messages in the DOM.
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
 * Scroll to load all messages in a lazy-loaded conversation.
 * Scrolls up from current position until no new messages appear.
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

  let lastMessageCount = countMessages();
  let stableCount = 0;
  let scrollAttempts = 0;
  let lastScrollTop = scrollContainer.scrollTop;

  // Progress callback helper
  const reportProgress = (message) => {
    showProgress(message);
    if (onProgress) onProgress(message);
  };

  reportProgress(`Loading conversation history... (${lastMessageCount} messages)`);

  while (scrollAttempts < SCROLL_CONFIG.maxScrollAttempts) {
    scrollAttempts++;

    // Scroll up
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - SCROLL_CONFIG.scrollStep);

    // Wait for content to potentially load
    await sleep(SCROLL_CONFIG.scrollDelay);

    // Check if we've reached the top
    const currentScrollTop = scrollContainer.scrollTop;
    const atTop = currentScrollTop === 0;

    // Count messages after scroll
    const currentMessageCount = countMessages();

    // Check for new messages
    if (currentMessageCount > lastMessageCount) {
      // New messages loaded, reset stability counter
      stableCount = 0;
      lastMessageCount = currentMessageCount;

      if (scrollAttempts % SCROLL_CONFIG.progressUpdateInterval === 0) {
        reportProgress(`Loading conversation history... (${currentMessageCount} messages)`);
      }
    } else if (atTop || currentScrollTop === lastScrollTop) {
      // At top or can't scroll further, check stability
      stableCount++;

      if (stableCount >= SCROLL_CONFIG.stabilityChecks) {
        // Wait a bit longer to make sure no more content is loading
        await sleep(SCROLL_CONFIG.stabilityDelay);

        // Final check
        const finalCount = countMessages();
        if (finalCount === lastMessageCount) {
          // Conversation is fully loaded
          reportProgress(`Loaded ${finalCount} messages`);
          return {
            success: true,
            messagesLoaded: finalCount,
            scrollAttempts
          };
        } else {
          // More messages appeared during stability delay
          lastMessageCount = finalCount;
          stableCount = 0;
        }
      }
    } else {
      // Still scrolling but no new messages yet
      stableCount = 0;
    }

    lastScrollTop = currentScrollTop;
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
 * Processes in chunks for large conversations.
 * @returns {Promise<Array>} - Array of turn objects
 */
async function extractTurns() {
  const turns = [];

  // Try to find messages using various selectors
  let messageElements = document.querySelectorAll(SELECTORS.allMessages);

  // Fallback: combine user and assistant messages
  if (messageElements.length === 0) {
    const userMsgs = Array.from(document.querySelectorAll(SELECTORS.userMessage));
    const assistantMsgs = Array.from(document.querySelectorAll(SELECTORS.assistantMessage));

    // Interleave based on DOM position
    const allMsgs = [...userMsgs, ...assistantMsgs].sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    messageElements = allMsgs;
  }

  const totalMessages = messageElements.length;
  const BATCH_SIZE = 20;

  for (let i = 0; i < messageElements.length; i++) {
    const element = messageElements[i];

    // Determine role
    const isUser = element.matches(SELECTORS.userMessage) ||
                   element.getAttribute('data-message-author-role') === 'user' ||
                   element.classList.contains('user-query-container');

    if (isUser) {
      turns.push(extractUserTurn(element, i));
    } else {
      turns.push(extractAssistantTurn(element, i));
    }

    // Yield to event loop every BATCH_SIZE messages
    if (i > 0 && i % BATCH_SIZE === 0) {
      showProgress(`Extracting turn ${i}/${totalMessages}...`);
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
        turnCount: turns.length,
        imageCount: images.length,
        extractionErrors: errors,
        partialSuccess: errors.length > 0 || !!scrollResult.warning,
        scrollInfo: {
          messagesLoaded: scrollResult.messagesLoaded,
          scrollAttempts: scrollResult.scrollAttempts
        }
      },
      turns
    };

    hideProgress();

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
    countMessages,
    findScrollContainer,
    scrollToLoadAllMessages
  };
}
