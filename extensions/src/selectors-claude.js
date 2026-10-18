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
 *
 * RE-VERIFIED: 2026-10-17 against the live page through the real extension
 * (#409), after a capture exported the user's message and none of Claude's
 * replies while reporting contentComplete: true. Nothing on the page carries
 * `.font-claude-response` any more. The reply is now:
 *
 *   div[data-testid="assistant-message"][data-turn-key][data-is-streaming]
 *     h2.sr-only[data-find-omitted]               "Claude responded: …"
 *     … .group/status[data-find-omitted]          a collapsed status row
 *     … [data-transcript-engine-root]             the reply text
 *         … div[role="group"][aria-label="bash code"]   a code block
 *             div[data-find-omitted]                    its language label
 *             pre.code-block__code > code.language-bash
 *     div[data-testid="message-actions"]          toolbar, with a timestamp
 *
 * and the user row:
 *
 *   div[data-user-scope] > div[data-turn-key]
 *     … div[data-testid="file-thumbnail"] … img (blob:)   an upload, BESIDE
 *     … div[data-testid="user-message"]                   the text
 *
 * `data-find-omitted` is the page's own mark for "not content" (it keeps an
 * element out of find-in-page); it is on the heading, the status row and the
 * code label, and all three are stripped from the reply text. The 2026-05
 * selectors stay beside the new ones.
 */

const SELECTORS = {
  site: 'claude',

  // Conversation container — the main content column
  conversationContainer: '[class*="flex-1"][class*="flex-col"]',

  // Session title — Claude uses document.title
  sessionTitle: null, // Claude has no in-page title element; use document.title

  // Scroll container
  //
  // 2026-10 (#409): the transcript scrolls in div[data-autoscroll-container],
  // and it goes first. The class test below it matches the conversation-list
  // SIDEBAR first in document order, and the sidebar really scrolls, so it
  // won: measured live, Clio scrolled the sidebar and exported the 7 of 18
  // messages already rendered.
  scrollContainer: '[data-autoscroll-container], [class*="flex-1"][class*="overflow-y-auto"], [data-scroll-container]',

  // Message elements
  // 2026-10 (#409): the user's whole ROW, [data-user-scope] [data-turn-key],
  // not just its text bubble: an upload sits in the row beside the bubble, and
  // the row is what the capture cache clones, so the clone must hold both.
  // The bubble selector stays for the 2026-05 markup; where both match, the
  // bubble is inside the row and queryMessages() keeps only the row.
  userMessage: '[data-testid="user-message"], [data-user-scope] [data-turn-key]',
  // The user's text, inside the row (or the message itself, 2026-05).
  userContent: '[data-testid="user-message"]',
  // One .font-claude-response per assistant turn — the outer response-container.
  // Stable across both pre-redesign (oldest) and modern Claude DOM.
  // Do NOT use [data-testid="action-bar-copy"] — Claude renders that on user
  // messages too, which caused duplicate assistant entries (issue #32).
  // Do NOT use [class="font-claude-response-body"] — that's per paragraph, not per turn.
  // 2026-10 (#409): [data-testid="assistant-message"], one per reply.
  assistantMessage: '.font-claude-response:not(.font-claude-response-body), [data-testid="assistant-message"]',

  // All messages (union of user + assistant)
  allMessages: '[data-testid="user-message"], [data-user-scope] [data-turn-key], ' +
    '.font-claude-response:not(.font-claude-response-body), [data-testid="assistant-message"]',

  // 2026-10 (#409): each message's own id. Measured over a full walk of an
  // 18-message conversation: 18 distinct keys, one per row, none changing as
  // rows mounted and unmounted. It keys the capture cache, which Claude now
  // needs — see ordersFromCapture.
  messageIdAttribute: 'data-turn-key',

  // 2026-10 (#409): the reply's text lives here, apart from the heading,
  // the status row and the toolbar that share the message element. Where it
  // is present it is the content; where absent, the 2026-05 path runs.
  replyTextRoot: '[data-transcript-engine-root]',
  // Page chrome inside the text root: the code block's language label is
  // data-find-omitted, and copy buttons and status announcements are not text.
  replyTextChrome: '[data-find-omitted], button, [role="status"]',

  // Where the images-offered count looks (#410): each message's row. Both
  // the user row and the reply carry data-turn-key.
  imageScope: '[data-turn-key]',
  turnKeyAttribute: 'data-turn-key',

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
  // 2026-10 (#409): the block's wrapper, holding the label and copy button
  // beside the <pre>; replaced whole by the fence (codeBlockRootOf).
  codeBlockRoot: '[role="group"][aria-label*="code"]',

  // Images
  image: 'img',

  // Citation decoration (#279). Null because no citation-favicon markup has
  // been verified against this site's DOM, and a guessed selector here would
  // silently drop real images. The favicon-host URL test in content.js still
  // applies on every site, so a Google-favicon fetch cannot leak through here
  // either; this selector only adds the role-based half where it is known.
  citationDecoration: null,

  // Attached-file capture (#262) is ChatGPT-only for now: no equivalent card
  // or download control has been verified on this site's DOM. Left null so the
  // scan is skipped rather than guessing at selectors nobody has probed.
  //
  // 2026-10 (#409): Claude's transcript now virtualizes. Measured on an
  // 18-message conversation: 3 to 11 rows in the DOM at once, 7 at the top.
  // Reading the live DOM after the scroll — what this site did until now —
  // exports one window of the conversation. So, as on ChatGPT, turns come from
  // the capture cache, and the cache's ordering confidence is about this
  // site's export (#272). On the 2026-05 markup no element carries
  // messageIdAttribute, nothing is cached, and extraction falls back to the
  // live DOM exactly as before.
  ordersFromCapture: true,

  uploadedFileCard: null,
  downloadAffordance: null,

  // Streaming indicator
  // `^=`, not `*=` (#409): the 2026-10 markup puts the message's own text into
  // button labels ("Show message actions for You said: …"), so a substring
  // test refused every conversation in which anyone had typed "Stop", claiming
  // Claude was still generating. The real control's label begins with it.
  streamingIndicator: 'button[aria-label^="Stop"], [data-streaming="true"], [data-is-streaming="true"]',

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
