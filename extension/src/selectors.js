/**
 * Centralized DOM selectors for Gemini UI elements.
 * Isolated here for easy maintenance when Gemini updates their UI.
 *
 * LLD Reference: docs/reports/1/lld-clio.md Section 6.1
 */

const SELECTORS = {
  // Conversation structure
  conversationContainer: '[data-conversation-id], .conversation-container, main',
  sessionTitle: 'h1[data-conversation-title], .conversation-title, h1',

  // Message elements
  userMessage: '[data-message-author-role="user"], .user-query-container, .query-content',
  assistantMessage: '[data-message-author-role="model"], .model-response-container, .response-container',

  // All messages (for DOM order traversal)
  allMessages: '[data-message-author-role], .message-container, .conversation-turn',

  // Expandable content (note: :has-text is not valid CSS, use data attributes or classes)
  expandButton: 'button[aria-expanded="false"], [data-expand-button], .expand-button',
  thinkingToggle: '[data-thinking-toggle], .thinking-toggle, button[aria-label*="thinking"]',
  thinkingContent: '.thinking-content, [data-thinking-content], .thought-process',

  // Code blocks
  codeBlock: 'pre code, .code-block code, code-block',
  codeLanguage: '[data-language], .code-language, .language-label',

  // Images
  image: 'img',

  // Streaming indicator (to detect active generation)
  streamingIndicator: 'button[aria-label*="Stop"], .streaming-indicator, .generating, [data-streaming="true"]'
};

// For use in content script (non-module context)
if (typeof window !== 'undefined') {
  window.SELECTORS = SELECTORS;
}

// For use in tests (module context)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SELECTORS };
}
