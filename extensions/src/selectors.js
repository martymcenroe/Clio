/**
 * Centralized DOM selectors for Gemini UI elements.
 * Isolated here for easy maintenance when Gemini updates their UI.
 *
 * VERIFIED: 2026-05-23 against three real Gemini conversation DOM saves
 * (issue #115):
 *   - AgentOS Refactor (Jan/Feb 2026, oldest) — 10 turns
 *   - IEEE Document Title (current) — 10 turns
 *   - Power Sector Organizations (current) — 1 turn
 *
 * In all three samples the primary custom elements work cleanly:
 *   <user-query> count == <model-response> count == turn count
 *
 * `[data-message-author-role]` did NOT match in any of the three samples —
 * those union-fallbacks have been zero-match in real Gemini DOM for at
 * least 4 months. Kept in the union anyway: extension tests
 * (auto-scroll, large-conversation, validateSelectors) deliberately
 * model an alternate Gemini DOM shape via `data-message-author-role`,
 * treating the fallback as a contractual support path for hypothetical
 * Gemini variants. Not safe to retire without re-aligning those tests.
 *
 * Originally last verified 2026-01-19.
 *
 * LLD Reference: docs/reports/1/lld-clio.md Section 6.1
 */

const SELECTORS = {
  site: 'gemini',

  // Conversation structure
  // VERIFIED: <div class="conversation-container message-actions-hover-boundary" id="...">
  conversationContainer: '.conversation-container, [data-conversation-id]',
  // VERIFIED: <span class="conversation-title gds-title-m">
  sessionTitle: '.conversation-title, h1[data-conversation-title], h1',
  // 2026-10 (#423): neither match is the title any more. `.conversation-title`
  // is the mode picker's label ("Auto", inside bard-mode-switcher) and the one
  // <h1> is a screen-reader heading, "Conversation with Gemini", the same on
  // every page; an export was titled "Auto". Matches inside these are skipped,
  // and the title comes from document.title.
  titleChrome: 'bard-mode-switcher, .cdk-visually-hidden',

  // Scroll container (for lazy-loaded conversations)
  // VERIFIED: <div id="chat-history" class="chat-history-scroll-container">
  scrollContainer: '#chat-history, .chat-history-scroll-container, [data-scroll-container]',

  // Message elements
  // VERIFIED: <user-query> custom element with nested .query-text
  userMessage: 'user-query, [data-message-author-role="user"], .user-query-container',
  // VERIFIED: <model-response> custom element with nested .response-container
  assistantMessage: 'model-response, [data-message-author-role="model"], .model-response-container',

  // All messages (individual messages, not containers)
  // NOTE: .conversation-container contains BOTH user+assistant, so don't count it
  // Use userMessage + assistantMessage selectors for accurate count
  allMessages: 'user-query, model-response, [data-message-author-role], .conversation-turn',

  // Expandable content - SCOPED TO MESSAGE CONTENT ONLY
  // FIXED: Was 'button[aria-expanded="false"]' which clicked menus, settings, etc.
  // Now scoped to only buttons inside message elements
  expandButton: 'user-query button[aria-expanded="false"], model-response button[aria-expanded="false"], .conversation-container button[aria-expanded="false"]:not([aria-haspopup])',

  // VERIFIED: <model-thoughts data-test-id="model-thoughts">
  thinkingToggle: '[data-test-id="model-thoughts"] button, model-thoughts button, [data-thinking-toggle], button[aria-label*="thinking"]',
  // VERIFIED: .thoughts-body inside model-thoughts
  thinkingContent: 'model-thoughts .thoughts-body, .thinking-content, [data-thinking-content], .thought-process',

  // Code blocks
  //
  // 2026-10 (#422): a <code-block> holds a header (div.code-block-decoration:
  // the language label "Bash", then Download and Copy buttons) and then
  // pre > code. The bare `code-block` alternative matched the whole element,
  // header included, and as the first match in document order it was the one
  // turned into the fence, so the label became the code's first line
  // ("Bash#!/bin/bash"). The code is read from pre > code, and the
  // <code-block> is the root replaced by the fence.
  codeBlock: 'pre code, .code-block code',
  codeBlockRoot: 'code-block',
  codeLanguage: '[data-language], .code-language, .language-label',

  // Text that is page chrome, inside a message (#421): Angular CDK's
  // off-screen class. Each prompt carries an <h5> of it ("You said" and a
  // truncated copy of the prompt), each reply an <h6> ("Gemini said"); both
  // were read as message text.
  textChrome: '.cdk-visually-hidden',
  // The prompt, one element per line (#421). Read line by line and joined
  // with newlines; each line carries one space of template whitespace at
  // either end.
  userLine: 'p.query-text-line',

  // Images
  image: 'img',
  // Where the images-offered count looks (#424): each exchange's container,
  // which holds the prompt and the reply. The account avatar and the
  // sidebar's icons are outside every one.
  imageScope: '.conversation-container',

  // Citation decoration (#279). Null because no citation-favicon markup has
  // been verified against this site's DOM, and a guessed selector here would
  // silently drop real images. The favicon-host URL test in content.js still
  // applies on every site, so a Google-favicon fetch cannot leak through here
  // either; this selector only adds the role-based half where it is known.
  citationDecoration: null,

  // Attached-file capture (#262) is ChatGPT-only for now: no equivalent card
  // or download control has been verified on this site's DOM. Left null so the
  // scan is skipped rather than guessing at selectors nobody has probed.
  // Turns are read from the live DOM here, not from the capture cache, so the
  // cache's ordering confidence is not about this site's export (#272).
  ordersFromCapture: false,

  uploadedFileCard: null,
  downloadAffordance: null,

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
