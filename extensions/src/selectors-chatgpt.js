/**
 * Centralized DOM selectors for ChatGPT UI elements.
 * Isolated here for easy maintenance when ChatGPT updates their UI.
 *
 * VERIFIED: 2026-05-23 from two real ChatGPT DOM snapshots saved via
 * Chrome "Webpage, Single File":
 *   - Find Missing Number (older, chatgpt.com/c/85301244-...)
 *   - Contract Review Recommendations (newer, chatgpt.com/c/69eff2c8-...)
 *
 * Both samples have zero <article> elements. ChatGPT dropped the
 * <article data-turn="..."> wrapper at some point between the original
 * 2026-02-28 verification (issue #15) and now (#116). The per-turn
 * boundary is the inner div with `data-message-author-role`. We select
 * on that attribute directly — no article-based selector path.
 */

const SELECTORS = {
  site: 'chatgpt',

  // Conversation container — main content area
  conversationContainer: 'main',

  // Session title — ChatGPT uses document.title directly (no suffix)
  sessionTitle: null,

  // Scroll container
  scrollContainer: 'main [class*="overflow-y-auto"], main',

  // Message elements — current ChatGPT renders each turn as a div
  // bearing `data-message-author-role="user"` or `="assistant"`.
  userMessage: '[data-message-author-role="user"]',
  assistantMessage: '[data-message-author-role="assistant"]',

  // All messages (union of user + assistant)
  allMessages: '[data-message-author-role="user"], [data-message-author-role="assistant"]',

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
