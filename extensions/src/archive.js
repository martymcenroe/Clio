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

/** Compose the per-conversation ZIP path (organized under a clio-archive/ folder). */
function zipName(conv, data) {
  const id = (conv.conversation_id || '').slice(0, 8);
  const title = sanitize(conv.title || (data && data.metadata && data.metadata.title) || 'untitled');
  return `clio-archive/${conv.site}-${title}-${id}.zip`;
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

/** Navigate the worker tab to a conversation and run the existing extractor. */
async function navigateAndExtract(tabId, url, site) {
  await chrome.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);
  await sleep(1500); // let the SPA render + lazy content settle
  try {
    const resp = await sendExtract(tabId);
    if (!resp || !resp.success) throw new Error((resp && resp.error) || 'extraction failed');
    return resp; // { success, data, images, warnings } — Clio's existing shape
  } catch (err) {
    // The content script may not be present after a fresh navigation — inject it and retry once.
    if (!/receiving end|Could not establish/i.test(err.message || '')) throw err;
    await chrome.scripting.executeScript({ target: { tabId }, files: scriptsForSite(site) });
    await sleep(800);
    const resp = await sendExtract(tabId);
    if (!resp || !resp.success) throw new Error((resp && resp.error) || 'extraction failed after reinject');
    return resp;
  }
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
    extractionDiagnostics, DEFAULT_DEPS,
  };
}
