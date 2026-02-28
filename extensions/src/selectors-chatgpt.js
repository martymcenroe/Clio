/**
 * Centralized DOM selectors for ChatGPT UI elements.
 * Isolated here for easy maintenance when ChatGPT updates their UI.
 *
 * VERIFIED: 2026-02-28 from real ChatGPT DOM snapshot via Playwright
 * Source: chatgpt.com/c/67bd8097-... (Strangler Pattern in Python)
 */

const SELECTORS = {
  site: 'chatgpt',

  // Conversation container — ChatGPT renders turns as <article> elements
  // inside a main content area. The articles themselves are the containers.
  conversationContainer: 'main',

  // Session title — ChatGPT uses document.title directly (no suffix)
  sessionTitle: null,

  // Scroll container
  scrollContainer: 'main [class*="overflow-y-auto"], main',

  // Message elements — ChatGPT uses <article> with data-turn attribute
  userMessage: 'article[data-turn="user"]',
  assistantMessage: 'article[data-turn="assistant"]',

  // All messages (union of user + assistant)
  allMessages: 'article[data-turn="user"], article[data-turn="assistant"]',

  // Content selectors within messages
  // User text is inside .whitespace-pre-wrap
  userContent: '.whitespace-pre-wrap',
  // Assistant text is inside .markdown.prose
  assistantContent: '.markdown',

  // Expandable content — no generic expand buttons in ChatGPT
  expandButton: null,

  // Thinking/reasoning — ChatGPT shows "Reasoned about X for Y seconds"
  // in a button inside a flex container before the response. Not expandable
  // for o1; may be expandable for newer models.
  thinkingToggle: null,
  thinkingContent: null,
  // Reasoning label — the container with "Reasoned about..." text
  reasoningLabel: '.flex.items-start.gap-3.pb-2',

  // Response content — the message element with data-message-author-role
  responseContent: '[data-message-author-role="assistant"]',

  // Code blocks — ChatGPT uses <pre> with CodeMirror inside
  // Language label is in a sticky header div inside the pre
  codeBlock: 'pre code, pre .cm-content',
  codeLanguage: 'pre [class*="sticky"]',

  // Images
  image: 'img:not([class*="icon"]):not([alt="Profile image"])',

  // Streaming indicator
  streamingIndicator: 'button[aria-label*="Stop"], [data-streaming="true"], [class*="result-streaming"]',

  // Loading indicator
  loadingIndicator: '[role="progressbar"], [aria-busy="true"]',

  // Model slug on assistant messages
  modelSlug: '[data-message-model-slug]'
};

// For use in content script (non-module context)
if (typeof window !== 'undefined') {
  window.SELECTORS = SELECTORS;
}

// For use in tests (module context)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SELECTORS };
}
