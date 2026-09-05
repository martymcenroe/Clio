/**
 * Attached-file capture during the scroll (#262).
 *
 * A conversation carrying roughly 150 files exported zero of them. The cause
 * was timing, not selectors: the pass ran AFTER the scroll, by which point
 * virtualization had evicted every message but the oldest window, so the
 * affordances it went looking for no longer existed. Capture therefore has to
 * happen on every sweep, from live nodes, exactly as message capture does
 * (#256).
 *
 * Two classes, both VERIFIED against the live page 2026-09-05, and they are not
 * equivalent:
 *
 *   uploaded    58 [data-testid="library-file-icon"] cards, every one in a USER
 *               message, every one reporting no button, no link and no
 *               clickable ancestor. Name and kind are recoverable; the bytes
 *               are not reachable from the transcript.
 *   generated   real "Download <name>" controls on assistant output, present
 *               only while their message is rendered.
 */

const {
  captureRenderedMessages,
  getMessageArtifacts,
  resetMessageCache,
  setMessageScroller,
  elementTextLines,
  extractTurnsChatGPT
} = require('../extensions/src/content.js');

const { SELECTORS } = require('../extensions/src/selectors-chatgpt.js');
global.SELECTORS = SELECTORS;

/** A user message carrying uploaded-file cards, as ChatGPT renders them. */
function userMessageWithFiles(id, files) {
  return `
    <div data-message-author-role="user" data-message-id="${id}">
      <div class="whitespace-pre-wrap">some prompt text</div>
      ${files.map(f => `
        <div class="pointer-events-none z-1"><div class="w-full p-2.5">
          <div class="overflow flex flex-row items-center gap-2">
            <div class="relative h-10 w-10">
              <div class="flex items-center justify-center">
                <svg data-testid="library-file-icon"></svg>
              </div>
            </div>
            <div class="flex flex-col">
              <div class="truncate">${f.name}</div>
              <div class="text-token-text-secondary">${f.kind}</div>
            </div>
          </div>
        </div></div>`).join('')}
    </div>`;
}

/** An assistant message carrying a download control. */
function assistantMessageWithDownload(id, label) {
  return `
    <div data-message-author-role="assistant" data-message-id="${id}">
      <div class="markdown">here is the file</div>
      <button aria-label="${label}">${label}</button>
    </div>`;
}

beforeEach(() => {
  resetMessageCache();
  document.body.innerHTML = '';
});

describe('elementTextLines', () => {
  test('reads the card lines without depending on innerText', () => {
    // jsdom does not implement innerText, so a card read through it would come
    // back as one run-together string and the kind would be lost.
    document.body.innerHTML =
      '<div id="c"><div>report.md</div><div>File</div></div>';
    expect(elementTextLines(document.getElementById('c'))).toEqual(['report.md', 'File']);
  });

  test('an element with only text still yields one line', () => {
    document.body.innerHTML = '<div id="c">solo.txt</div>';
    expect(elementTextLines(document.getElementById('c'))).toEqual(['solo.txt']);
  });
});

describe('uploaded file cards (#262)', () => {
  test('name and kind are captured from a card that has no controls', () => {
    document.body.innerHTML = userMessageWithFiles('u1', [
      { name: 'Pasted text(20260830-163052).txt', kind: 'Document' },
      { name: 'change-manifest.json', kind: 'File' }
    ]);
    setMessageScroller(null);
    captureRenderedMessages();

    const files = getMessageArtifacts('u1');
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      type: 'file',
      name: 'Pasted text(20260830-163052).txt',
      kind: 'Document',
      downloadable: false
    });
    expect(files[1].name).toBe('change-manifest.json');
  });

  test('the card is recorded as not downloadable, because it is not', () => {
    // Probed on the live page: no button, no link, no clickable ancestor, and
    // the icon sits under pointer-events-none. Saying "downloadable" here would
    // send a downstream tool looking for bytes that cannot be reached.
    document.body.innerHTML = userMessageWithFiles('u1', [
      { name: 'a.md', kind: 'File' }
    ]);
    captureRenderedMessages();

    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(getMessageArtifacts('u1')[0].downloadable).toBe(false);
  });

  test('sweeping the same message repeatedly does not duplicate a card', () => {
    document.body.innerHTML = userMessageWithFiles('u1', [
      { name: 'a.md', kind: 'File' }
    ]);
    captureRenderedMessages();
    captureRenderedMessages();
    captureRenderedMessages();

    expect(getMessageArtifacts('u1')).toHaveLength(1);
  });
});

describe('generated download affordances (#262)', () => {
  test('a Download control is captured with its filename', () => {
    document.body.innerHTML = assistantMessageWithDownload(
      'a1', 'Download SAM-Codex-Recon-Runtime-Promote-v1.0.2.py');
    captureRenderedMessages();

    const files = getMessageArtifacts('a1');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      type: 'artifact',
      name: 'SAM-Codex-Recon-Runtime-Promote-v1.0.2.py',
      downloadable: true
    });
  });

  test('a generic label does not get a filename invented for it', () => {
    document.body.innerHTML = assistantMessageWithDownload('a1', 'Download file');
    captureRenderedMessages();

    const files = getMessageArtifacts('a1');
    expect(files[0].name).toBeNull();
    expect(files[0].label).toBe('Download file');
  });

  test('site chrome is not mistaken for a conversation artifact', () => {
    // "Download apps" is the sidebar promo. It was the ONLY download-labelled
    // control on the page when the artifact pass ran after the scroll, which is
    // how a run reported affordances and saved nothing.
    document.body.innerHTML = assistantMessageWithDownload('a1', 'Download apps');
    captureRenderedMessages();

    expect(getMessageArtifacts('a1')).toHaveLength(0);
  });

  test('a control that renders after first sight is still captured', () => {
    // This is the timing failure in miniature. The message is captured on one
    // sweep; the download control only appears on a later one. A pass that read
    // the cached clone would never see it.
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="a1">
        <div class="markdown">working on it</div>
      </div>`;
    captureRenderedMessages();
    expect(getMessageArtifacts('a1')).toHaveLength(0);

    document.querySelector('[data-message-id="a1"]').innerHTML +=
      '<button aria-label="Download report.md">Download report.md</button>';
    captureRenderedMessages();

    expect(getMessageArtifacts('a1')).toHaveLength(1);
    expect(getMessageArtifacts('a1')[0].name).toBe('report.md');
  });

  test('files survive the eviction that hid them before', () => {
    // The whole point of #262: capture while it is rendered, read it after it
    // is gone.
    document.body.innerHTML = userMessageWithFiles('u1', [
      { name: 'early.md', kind: 'File' }
    ]);
    captureRenderedMessages();

    document.body.innerHTML = assistantMessageWithDownload('a9', 'Download late.py');
    captureRenderedMessages();

    expect(document.querySelector('[data-message-id="u1"]')).toBeNull();
    expect(getMessageArtifacts('u1')[0].name).toBe('early.md');
    expect(getMessageArtifacts('a9')[0].name).toBe('late.py');
  });
});

describe('files reach the exported turns (#262)', () => {
  test('a user turn carries its uploaded cards as attachments', async () => {
    document.body.innerHTML =
      userMessageWithFiles('u1', [{ name: 'spec.md', kind: 'File' }]) +
      assistantMessageWithDownload('a1', 'Download out.py');
    captureRenderedMessages();

    const turns = await extractTurnsChatGPT();
    expect(turns).toHaveLength(2);

    // The card sits OUTSIDE .whitespace-pre-wrap, which is the element the user
    // extractor is handed — so this only works because the merge happens where
    // the message element is still in scope.
    const files = turns[0].attachments.filter(a => a.type === 'file');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('spec.md');

    const artifacts = turns[1].attachments.filter(a => a.type === 'artifact');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].name).toBe('out.py');
  });

  test('image attachments are not disturbed by the merge', async () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant" data-message-id="a1">
        <div class="markdown">see below</div>
        <img src="https://example.test/x.png">
        <button aria-label="Download out.py">Download out.py</button>
      </div>`;
    captureRenderedMessages();

    const turns = await extractTurnsChatGPT();
    const types = turns[0].attachments.map(a => a.type);
    expect(types).toContain('image');
    expect(types).toContain('artifact');
  });
});

describe('other sites are left alone (#262)', () => {
  test('a site with no file selectors captures nothing', () => {
    const gemini = require('../extensions/src/selectors.js').SELECTORS;
    global.SELECTORS = { ...gemini, allMessages: SELECTORS.allMessages };

    document.body.innerHTML = userMessageWithFiles('u1', [
      { name: 'a.md', kind: 'File' }
    ]);
    captureRenderedMessages();
    expect(getMessageArtifacts('u1')).toHaveLength(0);

    global.SELECTORS = SELECTORS;
  });
});
