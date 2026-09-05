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

  // Scroll container.
  //
  // VERIFIED against the live page 2026-09-05 (#255): the element that actually
  // scrolls is `div.@w-sm/main:[...].group/scroll-root`, an ANCESTOR of <main>
  // two levels up — not a descendant. <main> is tall (4261px inside an 898px
  // box) but has overflow:visible, so assigning scrollTop to it does nothing,
  // and conversations exported with only the messages already on screen.
  //
  // `scroll-root` is listed first so it is chosen directly. The others are kept
  // as fallbacks for other builds; findScrollContainer() walks this list in
  // order and rejects any entry that does not genuinely scroll.
  scrollContainer: '[class*="scroll-root"], main [class*="overflow-y-auto"], main',

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

  // Files attached to a message (#262). Two distinct classes, VERIFIED against
  // the live page 2026-09-05.
  //
  // uploadedFileCard — the icon inside an operator-uploaded file card. All 58
  // seen were in USER messages, and every one reported no button, no link and
  // no clickable ancestor, with the icon under a `pointer-events-none` wrapper.
  // The name and kind are recoverable; the bytes are not reachable from the
  // transcript, so no click strategy will ever download them.
  //
  // downloadAffordance — the controls to scan for a "Download <name>" label on
  // generated artifacts. Kept broad because the control is sometimes a button
  // and sometimes a menu item; the label test is in content.js, and scoping the
  // query to a message element already excludes the sidebar's "Download apps".
  uploadedFileCard: '[data-testid="library-file-icon"]',
  downloadAffordance: 'button, a, [role="menuitem"]',

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
