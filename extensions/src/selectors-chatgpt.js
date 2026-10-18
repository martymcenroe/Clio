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
 *
 * RE-VERIFIED: 2026-10-17 against the live page (#399), after every ChatGPT
 * extraction failed with "Missing selectors: messages". ChatGPT replaced the
 * thread markup wholesale: no element carries data-message-author-role,
 * data-message-id, data-turn-id or .markdown any more. The new shape, probed
 * with tools/chatgpt/probe-turns.js:
 *
 *   div[data-turn-key=<user message id>]          one EXCHANGE, not one message
 *     div[data-chatgpt-search-unit-key="<k>:0:user"
 *         data-chatgpt-search-message-ids="<id>"]  the user message
 *       … [data-user-message-bubble] … .whitespace-pre-wrap   its text
 *     div[data-chatgpt-search-unit-key="<k>:2:assistant"
 *         data-chatgpt-search-message-ids="<id> <id>"]  the assistant message
 *       h4[data-conversation-role="assistant"].sr-only   "ChatGPT said:"
 *       … [data-markdown-text-style="assistant-message"]   its text
 *
 * The search-unit element is the message boundary: exactly one per message,
 * never nested, with the role as the suffix of its key and the message id as
 * the first token of its id list (content.js messageIdOf()). Every 1.9.1
 * selector is kept beside its replacement, so a browser still served the old
 * markup keeps working.
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
  //
  // 2026-10-17 (#399): the thread now scrolls in
  // `div[data-app-action-timeline-scroll].thread-scroll-container`, inside
  // <main>, and nothing on the page matches `scroll-root`. It goes first.
  scrollContainer: '[data-app-action-timeline-scroll], .thread-scroll-container, [class*="scroll-root"], main [class*="overflow-y-auto"], main',

  // Message elements. 2026-05 markup: a div bearing
  // `data-message-author-role="user"` or `="assistant"`. 2026-10 markup
  // (#399): the search-unit div, whose key ends in `:user` or `:assistant`.
  userMessage: '[data-message-author-role="user"], [data-chatgpt-search-unit-key$=":user"]',
  assistantMessage: '[data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]',

  // All messages (union of user + assistant). content.js queryMessages() adds
  // the replies no selector can name — see replyMarker.
  allMessages: '[data-message-author-role="user"], [data-message-author-role="assistant"], ' +
    '[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":assistant"]',

  // A reply with no search unit (#399).
  //
  // Every reply opens with this marker, in a block of its own. Three shapes,
  // all measured on one live conversation (79 replies):
  //
  //   28  the assistant unit is in the marker's block, right after the marker;
  //   39  the marker's block holds only a reasoning line ("Worked for 5m 34s",
  //       with an expand button), and the unit is in the NEXT block of the
  //       exchange (#400 — verified on 37 of 37 that had both);
  //   12  agent-style: tool activity ("Inspected…", "Fetched…") and text in
  //       bare MarkdownRoots, no unit and no message id anywhere.
  //
  // The third shape is invisible to the unit selectors, so the marker's block
  // is the message when it holds no unit AND holds reply text. The text test is
  // what keeps the second shape, a block of reasoning chrome, from being taken
  // for a reply; 1.9.2 caught those blocks and then discarded them in favour of
  // the unit, which reached the same export by a longer road.
  //
  // Found in code (content.js isAgentReply) rather than with
  // `div:has(> marker):not(:has(unit))`: Chrome evaluates that, but jsdom's
  // selector engine throws on any :has() in a document carrying ChatGPT's
  // bracketed class names, so no test could exercise it.
  replyMarker: '[data-chatgpt-agent-turn-start]',

  // The exchange a message belongs to (2026-10). Its value is the id of the
  // user message that opens the exchange, so it is unique per exchange.
  turnContainer: '[data-turn-key]',
  turnKeyAttribute: 'data-turn-key',

  // Where the images-offered count looks (#410): each exchange's region, NOT
  // the message elements. A generated image arrived on 2026-10-17 in a reply
  // block outside every message selector, and a count taken through those
  // selectors would have missed it exactly as the capture did.
  imageScope: '[data-turn-key]',

  // Content selectors within messages
  // User text is inside .whitespace-pre-wrap — still true in the 2026-10 markup.
  userContent: '.whitespace-pre-wrap',
  // Assistant text: .markdown.prose (2026-05), or the MarkdownRoot carrying
  // data-markdown-text-style (2026-10). Using it keeps the screen-reader
  // "ChatGPT said:" heading out of the content. A reply can hold several
  // (an agent-style reply interleaves them with tool activity); all of them are
  // read, in order.
  assistantContent: '.markdown, [data-markdown-text-style]',
  // Tool-activity lines in a reply ("Inspected 3 files", "Worked for 5m 34s").
  // They carry MarkdownRoots of their own, and they are not the reply's text.
  activityHeader: '[class*="activity-header"]',

  // Expandable content — no generic expand buttons in ChatGPT
  expandButton: null,

  // Thinking/reasoning — ChatGPT shows "Reasoned about X for Y seconds"
  // in a button inside a flex container before the response. Not expandable
  // for o1; may be expandable for newer models.
  thinkingToggle: null,
  thinkingContent: null,
  // Reasoning label — the container with "Reasoned about..." text
  reasoningLabel: '.flex.items-start.gap-3.pb-2',

  // Response content — the assistant message element
  responseContent: '[data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]',

  // Code blocks — 2026-05: <pre> with CodeMirror inside, language label in a
  // sticky header div inside the pre.
  //
  // 2026-10 (#399): a `[data-code-block]` root holding a header row (icon,
  // language label, copy/wrap controls) and then the code, in one of two
  // shapes seen side by side on one page:
  //   [data-code-block-source] > code             (no <pre> at all)
  //   … pre > code
  // The root is what extractTextContent() replaces with the fence, or the
  // header's label ("Bash") lands in the text beside it. The controls are how
  // the header row is found: nothing in its class names says header.
  codeBlock: 'pre code, pre .cm-content, [data-code-block] code',
  codeBlockRoot: '[data-code-block]',
  codeBlockControls: '[data-code-block-controls]',
  codeLanguage: 'pre [class*="sticky"]',

  // Images
  image: 'img:not([class*="icon"]):not([alt="Profile image"])',

  // Citation decoration (#279) — the little site icons rendered beside web
  // search citations, one per cited source, so a research-heavy conversation
  // accumulates them fast. A single 233-message capture collected 152: every
  // one a cross-origin fetch to Google's favicon service that cannot succeed
  // from an extension context, every one failing, and every one landing in
  // extractionErrors.
  //
  // They carry no conversation content. The domain each one depicts is already
  // in the citation URL in the message text.
  //
  // Matched by ROLE rather than by URL, because a URL test has already gone
  // stale once here: a 2026-05 snapshot renders the same favicon with
  // class="icon-sm", which SELECTORS.image's :not([class*="icon"]) excluded on
  // its own. That is why this stayed invisible until the markup dropped the
  // class and 152 of them started reaching the fetcher. Keying on the citation
  // affordance survives the next such rename; the favicon-host list in
  // content.js is the backstop for the reverse case.
  citationDecoration: '[aria-label="Sources"], [class*="footnote"], [data-testid*="citation"]',

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
  // Ordering comes from the capture cache on this site and only this site:
  // ChatGPT virtualizes, so extractTurnsChatGPT() reads getCapturedMessageEls()
  // rather than the live DOM. Gemini and Claude read the DOM directly, so the
  // cache's ordering confidence says nothing about their exports and must not
  // be reported or warned about there (#272).
  ordersFromCapture: true,

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
