/**
 * The README's documented JSON structure must match what the extension emits
 * (#281).
 *
 * The README documented `turns` / `turnCount`; the extension emits `messages` /
 * `messageCount`. A consumer written against the README got **zeros, not
 * errors** — `.turns` on a real export is an empty list and `.turnCount` is
 * null, because JSON access to a missing key is silent. The file reads as "an
 * export with no conversation in it", which is a plausible-looking result for a
 * tool whose known failure mode is capturing too little. That is exactly what
 * happened: a first pass over five exports reported 0 messages in all five, and
 * the first hypothesis was that extraction had failed.
 *
 * So this does not check the README against a hand-written list, which would be
 * a second document free to drift the same way. It runs a real extraction and
 * compares the README's key set against the keys that extraction actually
 * produced. The next rename fails here instead of waiting for someone to query
 * a key that is not there.
 */

const fs = require('fs');
const path = require('path');

const {
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

const { SELECTORS: CHATGPT } = require('../extensions/src/selectors-chatgpt.js');

const README = path.join(__dirname, '..', 'README.md');

const FAST = {
  scrollStep: 100, scrollDelay: 5, loadingAppearDelay: 2, mutationTimeout: 10,
  maxScrollAttempts: 10, loadingCheckInterval: 5, maxLoadingWait: 50,
  progressUpdateInterval: 5, stuckRetries: 2, topSettleRounds: 2
};

/**
 * The documented structure, parsed out of the README's first ```json block
 * inside the JSON Structure section.
 */
function documentedShape() {
  const md = fs.readFileSync(README, 'utf8');
  const section = md.split('### JSON Structure')[1];
  if (!section) throw new Error('README has no "### JSON Structure" section');

  // Scanned line by line rather than with a lazy regex. The documented example
  // contains a fenced code block INSIDE a JSON string value, so a
  // /```json\n([\s\S]*?)```/ match ends at that inner fence and hands back
  // truncated JSON — which fails as a parse error that looks like a malformed
  // README rather than a bad extractor.
  const lines = section.split('\n');
  const start = lines.findIndex(l => l.trim() === '```json');
  if (start === -1) throw new Error('README JSON Structure section has no json fence');
  const end = lines.findIndex((l, i) => i > start && l.trim() === '```');
  if (end === -1) throw new Error('README json fence is never closed');

  return JSON.parse(lines.slice(start + 1, end).join('\n'));
}

/** A real export, from a real extraction on a ChatGPT-shaped DOM. */
async function emittedShape() {
  global.SELECTORS = CHATGPT;
  setScrollConfig(FAST);
  document.body.innerHTML = `
    <div id="root" style="overflow-y: auto; height: 200px;">
      <main>
        <div data-message-author-role="user" data-message-id="u1">
          <div class="whitespace-pre-wrap">Hello, can you help me with...</div>
        </div>
        <div data-message-author-role="assistant" data-message-id="a1">
          <div class="markdown">Of course! Here is how...</div>
        </div>
      </main>
    </div>`;
  const el = document.getElementById('root');
  Object.defineProperty(el, 'scrollHeight', { get: () => 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });
  Object.defineProperty(el, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });

  try {
    const result = await extractConversation();
    expect(result.success).toBe(true);
    return result.data;
  } finally {
    resetScrollConfig();
  }
}

describe('README JSON structure matches the emitted export', () => {
  // Test ID: SCHEMA-001 — the defect itself, pinned so it cannot come back
  // under a different name.
  test('the README does not document turns/turnCount', () => {
    const md = fs.readFileSync(README, 'utf8');

    expect(md).not.toMatch(/"turnCount"/);
    expect(md).not.toMatch(/"turns"\s*:/);
  });

  // Test ID: SCHEMA-002 — the assertion that lasts. Every metadata key the
  // README shows must be one the extension actually emits.
  test('every documented metadata key is emitted', async () => {
    const emitted = await emittedShape();
    const documented = documentedShape();

    const emittedKeys = Object.keys(emitted.metadata).sort();
    const documentedKeys = Object.keys(documented.metadata).sort();

    const undocumentedInCode = documentedKeys.filter(k => !emittedKeys.includes(k));
    expect(undocumentedInCode).toEqual([]);
  });

  // Test ID: SCHEMA-003 — and the other direction, which is the one that
  // actually caught #281: a field the extension emits and the README omits is
  // how `messageCount` went unmentioned while `turnCount` was documented.
  test('every emitted metadata key is documented', async () => {
    const emitted = await emittedShape();
    const documented = documentedShape();

    const emittedKeys = Object.keys(emitted.metadata).sort();
    const documentedKeys = Object.keys(documented.metadata).sort();

    const missingFromReadme = emittedKeys.filter(k => !documentedKeys.includes(k));
    expect(missingFromReadme).toEqual([]);
  });

  // Test ID: SCHEMA-004 — the message array is named and shaped as documented.
  test('the message array name and message keys match', async () => {
    const emitted = await emittedShape();
    const documented = documentedShape();

    expect(Object.keys(documented)).toEqual(Object.keys(emitted));
    expect(Array.isArray(documented.messages)).toBe(true);

    // The union across roles, not the first message's keys: a user turn carries
    // no modelSlug and an assistant turn does, so comparing against one role
    // would reject a correctly documented field belonging to the other.
    const emittedMessageKeys = new Set(
      emitted.messages.flatMap(m => Object.keys(m)));
    for (const documentedMessage of documented.messages) {
      const undocumented = Object.keys(documentedMessage)
        .filter(k => !emittedMessageKeys.has(k));
      expect(undocumented).toEqual([]);
    }
  });
});
