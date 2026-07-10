/* global chrome, JSZip, getConversation, markDownloaded, markDownloadError, dequeueNext, statusCounts, sleepImpl */
// Clio 2.0 — batch-download worker (#60).
//
// The walk: for each queued conversation, navigate a worker tab to the
// conversation, run Clio's EXISTING DOM extractor (the same `{action:'extract'}`
// the single-conversation button uses — it renders the page, so it captures
// artifacts/documents the way the site API cannot), build the current-design
// ZIP (conversation.json + images/), download it, and record the result in the
// ledger (extensions/src/storage/db.js). Crash-resumable via the ledger.
//
// The loop (`runBatch`) and per-conversation step (`processOne`) take injected
// deps so they are unit-testable; the default deps are the real browser glue.

function sleep(ms) {
  // Overridable in tests to avoid real timers.
  if (typeof sleepImpl === 'function') return sleepImpl(ms);
  return new Promise((r) => setTimeout(r, ms));
}

const sanitize = (s) =>
  (s || 'untitled').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'untitled';

// A per-run tag so a fresh run lands in its own subfolder and can't collide with
// files from an earlier (e.g. buggy) run.
let RUN_TAG = '';
const setRunTag = (t) => { RUN_TAG = t || ''; };
const archiveDir = () => (RUN_TAG ? `clio-archive/${RUN_TAG}` : 'clio-archive');

/** Compose the per-conversation ZIP path (organized under the run's folder). */
function zipName(conv, data) {
  const id = (conv.conversation_id || '').slice(0, 8);
  const title = sanitize(conv.title || (data && data.metadata && data.metadata.title) || 'untitled');
  return `${archiveDir()}/${conv.site}-${title}-${id}.zip`;
}

/** What the extractor saw for one conversation — recorded in the run report. */
function extractionDiagnostics(resp) {
  const data = (resp && resp.data) || {};
  const meta = data.metadata || {};
  const messages = data.messages || [];
  return {
    messageCount: meta.messageCount != null ? meta.messageCount : messages.length,
    imageCount: meta.imageCount != null ? meta.imageCount : ((resp && resp.images) || []).length,
    textLength: JSON.stringify(messages).length,
  };
}

// ---------------------------------------------------------------------------
// Browser glue (default deps) — reuse the existing extract / zip / download path
// ---------------------------------------------------------------------------

/** Wait until a tab finishes loading. */
function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tab load timeout'));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Send the existing extract message to the content script in a tab. */
function sendExtract(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'extract' }, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

// The per-site content scripts, for re-injection when a navigation drops them.
const CONTENT_SCRIPTS = {
  gemini: ['src/selectors.js', 'src/content.js'],
  claude: ['src/selectors-claude.js', 'src/content.js'],
  chatgpt: ['src/selectors-chatgpt.js', 'src/content.js'],
};
const scriptsForSite = (site) => CONTENT_SCRIPTS[site] || CONTENT_SCRIPTS.claude;

/**
 * Navigate the worker tab to a conversation and run the existing extractor.
 * Waits for the conversation's messages to actually render (SPA load is not
 * instant) by retrying with growing delays. Two failure classes are handled:
 *  - "receiving end / Could not establish" → content script dropped by the
 *    navigation; re-inject and retry.
 *  - "Missing selectors: messages" → messages haven't rendered yet; wait longer.
 *    If it persists across all attempts the conversation is (likely) empty.
 */
async function navigateAndExtract(tabId, url, site) {
  await chrome.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);

  let lastError = 'extraction failed';
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await sleep(Math.min(1500 + attempt * 1500, 6000)); // 1.5s, 3s, 4.5s, 6s, 6s
    let resp;
    try {
      resp = await sendExtract(tabId);
    } catch (err) {
      if (/receiving end|Could not establish/i.test(err.message || '')) {
        // Content script isn't present after the navigation — inject and retry.
        await chrome.scripting.executeScript({ target: { tabId }, files: scriptsForSite(site) });
        continue;
      }
      throw err;
    }
    if (resp && resp.success) return resp; // { success, data, images, warnings }
    lastError = (resp && resp.error) || 'extraction failed';
    // A non-timing extractor error is real — surface it immediately.
    if (!/missing selectors: messages/i.test(lastError)) throw new Error(lastError);
    // else: messages not rendered yet — loop and wait longer.
  }
  throw new Error(lastError); // exhausted retries: slow render or an empty conversation
}

/** Build the current-design ZIP (mirrors popup.js createZip). */
async function buildZip(data, images) {
  const zip = new JSZip();
  zip.file('conversation.json', JSON.stringify(data, null, 2));
  if (images && images.length) {
    const folder = zip.folder('images');
    for (const img of images) {
      if (img && img.dataUrl && img.filename) {
        folder.file(img.filename.replace('images/', ''), img.dataUrl.split(',')[1], { base64: true });
      }
    }
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Save a ZIP blob via Chrome's download flow. */
function downloadZip(blob, filename) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(downloadId);
    });
  });
}

const DEFAULT_DEPS = { navigateAndExtract, buildZip, downloadZip };

// ---------------------------------------------------------------------------
// The walk (testable core)
// ---------------------------------------------------------------------------

/** Process one conversation end-to-end; records success/failure in the ledger. */
async function processOne(tabId, conv, deps = DEFAULT_DEPS) {
  const keyObj = {
    site: conv.site,
    account_label: conv.account_label,
    conversation_id: conv.conversation_id,
  };
  try {
    const resp = await deps.navigateAndExtract(tabId, conv.url, conv.site);
    const blob = await deps.buildZip(resp.data, resp.images);
    const filename = zipName(conv, resp.data);
    await deps.downloadZip(blob, filename);
    await markDownloaded(keyObj, { zip_name: filename });
    return { ok: true, filename, ...extractionDiagnostics(resp) };
  } catch (err) {
    await markDownloadError(keyObj, (err && err.message) || String(err));
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

/**
 * Drain the ledger's queue, walking one conversation at a time.
 * `control`: { tabId, paceMs, isPaused(), isCancelled(), onProgress(counts, last) }
 */
async function runBatch(control, deps = DEFAULT_DEPS) {
  let done = 0;
  let failed = 0;
  for (;;) {
    if (control.isCancelled && control.isCancelled()) break;
    if (control.isPaused && control.isPaused()) { await sleep(400); continue; }

    const queued = await dequeueNext();
    if (!queued) break; // queue empty → finished

    const conv = await getConversation(queued);
    if (!conv) { failed += 1; continue; } // orphan queue row, skip

    const result = await processOne(control.tabId, conv, deps);
    if (result.ok) done += 1; else failed += 1;

    if (control.onProgress) control.onProgress(await statusCounts(), { conv, result });
    await sleep(control.paceMs || 800); // be polite between conversations
  }
  return { done, failed };
}

/** Seed the ledger + queue from an enumerated conversation list (idempotent). */
async function seedQueue(convs, site, account_label) {
  let queued = 0;
  for (const c of convs) {
    await upsertConversation({ site, account_label, conversation_id: c.conversation_id, title: c.title, url: c.url });
    await enqueueExtraction({ site, account_label, conversation_id: c.conversation_id });
    queued += 1;
  }
  return { enumerated: convs.length, queued };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    zipName, sanitize, buildZip, navigateAndExtract, waitForTabComplete, sendExtract,
    downloadZip, processOne, runBatch, seedQueue, scriptsForSite, CONTENT_SCRIPTS,
    extractionDiagnostics, setRunTag, archiveDir, DEFAULT_DEPS,
  };
}
