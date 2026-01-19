/**
 * Centralized DOM selectors for Gemini UI elements.
 * Isolated here for easy maintenance when Gemini updates their UI.
 *
 * VERIFIED: 2026-01-19 from real Gemini DOM snapshot
 * Source: docs/html-input/Google Gemini.htm
 *
 * LLD Reference: docs/reports/1/lld-clio.md Section 6.1
 */

const SELECTORS = {
  // Conversation structure
  // VERIFIED: <div class="conversation-container message-actions-hover-boundary" id="...">
  conversationContainer: '.conversation-container, [data-conversation-id], main',
  // VERIFIED: <span class="conversation-title gds-title-m">
  sessionTitle: '.conversation-title, h1[data-conversation-title], h1',

  // Scroll container (for lazy-loaded conversations)
  // VERIFIED: <div id="chat-history" class="chat-history-scroll-container">
  scrollContainer: '#chat-history, .chat-history-scroll-container, [data-scroll-container], main',

  // Message elements
  // VERIFIED: <user-query> custom element with nested .query-text
  userMessage: 'user-query, [data-message-author-role="user"], .user-query-container',
  // VERIFIED: <model-response> custom element with nested .response-container
  assistantMessage: 'model-response, [data-message-author-role="model"], .model-response-container, .response-container',

  // All messages (conversation turns)
  // VERIFIED: <div class="conversation-container"> contains both user-query and model-response
  allMessages: '.conversation-container, [data-message-author-role], .conversation-turn',

  // Expandable content
  expandButton: 'button[aria-expanded="false"], [data-expand-button], .expand-button',
  // VERIFIED: <model-thoughts data-test-id="model-thoughts">
  thinkingToggle: '[data-test-id="model-thoughts"] button, model-thoughts button, [data-thinking-toggle], button[aria-label*="thinking"]',
  // VERIFIED: .thoughts-body inside model-thoughts
  thinkingContent: 'model-thoughts .thoughts-body, .thinking-content, [data-thinking-content], .thought-process',

  // Code blocks
  codeBlock: 'pre code, .code-block code, code-block',
  codeLanguage: '[data-language], .code-language, .language-label',

  // Images
  image: 'img',

  // Streaming indicator (to detect active generation)
  streamingIndicator: 'button[aria-label*="Stop"], .streaming-indicator, .generating, [data-streaming="true"]',

  // Loading indicator (shown while fetching older messages during scroll)
  // VERIFIED: <mat-progress-spinner aria-label="Loading conversation history" class="mat-mdc-progress-spinner mdc-circular-progress">
  loadingIndicator: 'mat-progress-spinner, .mdc-circular-progress, [role="progressbar"], [aria-busy="true"], .loading-spinner'
};

// For use in content script (non-module context)
if (typeof window !== 'undefined') {
  window.SELECTORS = SELECTORS;
}

// For use in tests (module context)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SELECTORS };
}
