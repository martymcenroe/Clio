/**
 * Centralized DOM selectors for Claude.ai UI elements.
 * Isolated here for easy maintenance when Claude updates their UI.
 *
 * VERIFIED: 2026-02-27 from real Claude DOM snapshot via Playwright
 * Source: data/claude-b5b2d739_Engineering-first-AI-solution-for-ATT_2026-02-27.json
 */

const SELECTORS = {
  site: 'claude',

  // Conversation container — the main content column
  conversationContainer: '[class*="flex-1"][class*="flex-col"]',

  // Session title — Claude uses document.title
  sessionTitle: null, // Claude has no in-page title element; use document.title

  // Scroll container
  scrollContainer: '[class*="flex-1"][class*="overflow-y-auto"], [data-scroll-container]',

  // Message elements
  userMessage: '[data-testid="user-message"]',
  assistantMessage: '[data-testid="action-bar-copy"]',

  // All messages (union of user + assistant)
  allMessages: '[data-testid="user-message"], [data-testid="action-bar-copy"]',

  // Expandable content — thinking toggles in Claude
  expandButton: null, // Claude doesn't use generic expand buttons
  thinkingToggle: '.row-start-1 button[aria-expanded="false"]',

  // Thinking and response content within assistant turns
  thinkingContent: '.row-start-1',
  responseContent: '.row-start-2',

  // Tool use — buttons with group/row class inside thinking row
  toolUseButton: '.row-start-1 button.group\\/row',

  // Code blocks
  codeBlock: 'pre code, .code-block code',
  codeLanguage: '[data-language], .language-label',

  // Images
  image: 'img',

  // Streaming indicator
  streamingIndicator: 'button[aria-label*="Stop"], [data-streaming="true"]',

  // Loading indicator
  loadingIndicator: '[role="progressbar"], [aria-busy="true"], .loading-spinner'
};

// For use in content script (non-module context)
if (typeof window !== 'undefined') {
  window.SELECTORS = SELECTORS;
}

// For use in tests (module context)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SELECTORS };
}
