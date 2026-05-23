/**
 * Centralized DOM selectors for Claude.ai UI elements.
 * Isolated here for easy maintenance when Claude updates their UI.
 *
 * VERIFIED: 2026-05-23 against three real Claude conversation DOM saves
 * spanning two DOM eras:
 *   - OLDEST: "AI for Construction" — pre-redesign Claude (15 turns)
 *   - MODERN-prose: "Haiku about rain" (1 turn, no tools)
 *   - MODERN-widget: Recruiter email artifact (1 turn, tool-call + email widget)
 *
 * Per-turn assistant boundary is `.font-claude-response` (the outer div
 * containing all response content for a single turn). Verified stable in
 * BOTH eras:
 *   - OLDEST: 15 occurrences (matches 15 turns)
 *   - MODERN: 1 per turn
 *
 * Previously this selector was `.row-start-2`. That class:
 *   - does NOT exist in pre-redesign Claude DOM (0 matches in OLDEST sample)
 *   - DOES exist in modern Claude but as a sub-element (a grid row for tool
 *     calls), not as the per-turn boundary
 * Using `.row-start-2` meant zero turns extracted on older conversations,
 * and the right-count-for-the-wrong-reason on modern ones.
 *
 * User-message selector `[data-testid="user-message"]` is stable across
 * both eras.
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
  // One .font-claude-response per assistant turn — the outer response-container.
  // Stable across both pre-redesign (oldest) and modern Claude DOM.
  // Do NOT use [data-testid="action-bar-copy"] — Claude renders that on user
  // messages too, which caused duplicate assistant entries (issue #32).
  // Do NOT use [class="font-claude-response-body"] — that's per paragraph, not per turn.
  assistantMessage: '.font-claude-response:not(.font-claude-response-body)',

  // All messages (union of user + assistant)
  allMessages: '[data-testid="user-message"], .font-claude-response:not(.font-claude-response-body)',

  // Expandable content — thinking toggles in Claude
  expandButton: null, // Claude doesn't use generic expand buttons
  thinkingToggle: '.row-start-1 button[aria-expanded="false"]',

  // Thinking and response content within assistant turns
  // .row-start-1 (thinking) and .row-start-2 (response wrapper) exist only in
  // the modern grid-style DOM (when Claude renders a 2-row grid for tool calls
  // or thinking). On older Claude DOM these are absent — the assistant
  // response is just paragraphs directly inside .font-claude-response, and
  // the thinking/response split logic below is a no-op (which is correct).
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
