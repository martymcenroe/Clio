/**
 * Popup script for Clio.
 * Handles UI and download logic.
 *
 * LLD Reference: docs/reports/1/lld-clio.md
 */

/* global chrome, JSZip */

// ============================================================================
// UI Helpers
// ============================================================================

function setStatus(message, type = 'info') {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function showProgress(message) {
  const progressEl = document.getElementById('progress');
  const progressText = document.getElementById('progressText');
  progressEl.classList.add('visible');
  progressText.textContent = message;
}

function hideProgress() {
  const progressEl = document.getElementById('progress');
  progressEl.classList.remove('visible');
}

/**
 * Show a warning row when some images failed to fetch (typically due to
 * the provider's image-CDN not returning CORS headers permitting the
 * extension's fetch). Hides the row when failedCount is 0. The popup
 * still completes — the conversation text is unaffected — but the user
 * needs to know images are missing (#141).
 * @param {number} failedCount
 */
function showImageFetchWarning(failedCount) {
  const el = document.getElementById('imageFetchWarning');
  if (!el) return;
  const text = document.getElementById('imageFetchWarningText');
  if (failedCount > 0) {
    if (text) {
      text.textContent = failedCount === 1
        ? '1 image could not be saved (provider blocked the download). See conversation.json metadata.extractionErrors for details.'
        : `${failedCount} images could not be saved (provider blocked the download). See conversation.json metadata.extractionErrors for details.`;
    }
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function showResult(messageCount, images, errors, scrollInfo, isLastResult = false) {
  const resultEl = document.getElementById('result');
  resultEl.classList.add('visible');
  document.getElementById('messageCount').textContent = messageCount;
  document.getElementById('imageCount').textContent = images;
  document.getElementById('errorCount').textContent = errors;

  // Show scroll info if available
  const scrollInfoEl = document.getElementById('scrollInfo');
  if (scrollInfoEl && scrollInfo) {
    scrollInfoEl.textContent = `(${scrollInfo.messagesLoaded} loaded, ${scrollInfo.scrollAttempts} scrolls)`;
    scrollInfoEl.classList.add('visible');
  }

  // Show "last extraction" indicator if restoring from localStorage
  const lastIndicator = document.getElementById('lastExtractionIndicator');
  if (lastIndicator) {
    if (isLastResult) {
      lastIndicator.classList.add('visible');
    } else {
      lastIndicator.classList.remove('visible');
    }
  }
}

/**
 * Save extraction results to localStorage for persistence.
 * @param {Object} data - extraction result
 * @param {string} site - site key (claude / chatgpt / gemini) where the
 *   extraction happened, used by restoreLastResult to gate display on
 *   site match. Without it, the cached card is shown only when no
 *   current-site argument is supplied (test path).
 */
function saveLastResult(data, site) {
  try {
    const lastResult = {
      messageCount: data.metadata.messageCount,
      imageCount: data.metadata.imageCount,
      errorCount: data.metadata.extractionErrors.length,
      scrollInfo: data.metadata.scrollInfo,
      title: data.metadata.title,
      site: site || null,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('clio_lastResult', JSON.stringify(lastResult));
  } catch (e) {
    // Ignore localStorage errors
  }
}

/**
 * Restore last extraction result from localStorage if available.
 * Site-aware: when currentSite is provided, only restores if the cached
 * extraction was from the same site. Prevents the popup from showing
 * Gemini stats on a ChatGPT page (#138).
 * @param {string} [currentSite] - site key of the active tab
 *   (claude / chatgpt / gemini). If omitted, falls back to the legacy
 *   non-site-aware behavior. Old caches without a `site` field are
 *   always hidden when currentSite is provided.
 */
function restoreLastResult(currentSite) {
  try {
    const saved = localStorage.getItem('clio_lastResult');
    if (!saved) return false;
    const lastResult = JSON.parse(saved);
    // Only show if less than 1 hour old
    const age = Date.now() - new Date(lastResult.timestamp).getTime();
    if (age >= 60 * 60 * 1000) return false;
    // Site-mismatch gate. If caller passed currentSite, require the
    // cached extraction's site to match. Old caches (pre-#138) have no
    // site field and are always hidden when a currentSite is provided.
    if (currentSite && lastResult.site !== currentSite) return false;
    showResult(
      lastResult.messageCount,
      lastResult.imageCount,
      lastResult.errorCount,
      lastResult.scrollInfo,
      true // isLastResult
    );
    setStatus(`Last: ${lastResult.title || 'Untitled'}`, 'info');
    return true;
  } catch (e) {
    // Ignore localStorage errors
  }
  return false;
}

function setButtonState(enabled, text = 'Extract Conversation') {
  const extractBtn = document.getElementById('extractBtn');
  extractBtn.disabled = !enabled;
  extractBtn.textContent = text;
}

// ============================================================================
// Site Detection Helpers
// ============================================================================

/**
 * Check if a URL is a supported conversation site.
 * @param {string} url
 * @returns {boolean}
 */
function isSupportedSite(url) {
  if (!url) return false;
  return url.includes('gemini.google.com') || url.includes('claude.ai') || url.includes('chatgpt.com');
}

/**
 * Get filename prefix based on site URL.
 * @param {string} url
 * @returns {string}
 */
function getSitePrefix(url) {
  if (url && url.includes('claude.ai')) return 'claude';
  if (url && url.includes('chatgpt.com')) return 'chatgpt';
  return 'gemini';
}

// ============================================================================
// Filename Sanitization
// ============================================================================

function sanitizeFilename(filename) {
  if (!filename) return 'untitled';
  return filename
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
}

// ============================================================================
// Zip Creation
// ============================================================================

/**
 * Create zip file from extraction result.
 * @param {Object} data - Conversation JSON data
 * @param {Array} images - Array of image objects with dataUrl
 * @returns {Promise<Blob>} - Zip file blob
 */
async function createZip(data, images) {
  const zip = new JSZip();

  // Add conversation.json
  const jsonContent = JSON.stringify(data, null, 2);
  zip.file('conversation.json', jsonContent);

  // Add images folder
  const imagesFolder = zip.folder('images');

  for (const img of images) {
    if (img.dataUrl && img.filename) {
      // Convert data URL to binary
      const base64Data = img.dataUrl.split(',')[1];
      const filename = img.filename.replace('images/', '');
      imagesFolder.file(filename, base64Data, { base64: true });
    }
  }

  // Generate zip with STORE compression for images (faster)
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

// ============================================================================
// Download
// ============================================================================

/**
 * Download a blob as a file.
 * @param {Blob} blob - File blob
 * @param {string} filename - Download filename
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  }, (downloadId) => {
    // Clean up object URL after download starts
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

/**
 * Estimate total export size.
 * @param {Array} images - Array of image objects
 * @returns {number} - Estimated size in bytes
 */
function estimateExportSize(images) {
  let size = 0;
  for (const img of images) {
    if (img.dataUrl) {
      // Base64 is ~33% larger than binary, so divide by 1.33
      size += Math.floor((img.dataUrl.length - img.dataUrl.indexOf(',')) * 0.75);
    }
  }
  return size;
}

/**
 * Format bytes as human readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================================================
// Content-script messaging with re-inject recovery (#139)
// ============================================================================

/**
 * Pattern that matches the Chrome error raised when chrome.tabs.sendMessage
 * targets a tab whose content script is not loaded. Two variant strings
 * are seen in the wild depending on Chrome version.
 */
const RECEIVING_END_ERROR = /Receiving end does not exist|Could not establish connection/i;

/**
 * Map a site key to the [selectors-file, content.js] script paths to
 * inject when recovering from a missing content script.
 */
function scriptsForSite(site) {
  if (site === 'claude') return ['src/selectors-claude.js', 'src/content.js'];
  if (site === 'chatgpt') return ['src/selectors-chatgpt.js', 'src/content.js'];
  return ['src/selectors.js', 'src/content.js']; // gemini (default)
}

/**
 * sendMessage wrapper that converts the Chrome callback-style API to a
 * Promise. Resolves with the response or rejects with an Error whose
 * message is chrome.runtime.lastError.message.
 */
function sendExtractMessageOnce(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'extract' }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Send the extract message to the active tab. If the content script is
 * not loaded ("Receiving end does not exist" / "Could not establish
 * connection"), inject it via chrome.scripting.executeScript and retry
 * exactly once. Any other error bubbles up unchanged. After exhausting
 * the retry, raises a user-friendly Error.
 */
async function sendExtractMessage(tab) {
  try {
    return await sendExtractMessageOnce(tab.id);
  } catch (err) {
    if (!RECEIVING_END_ERROR.test(err.message || '')) {
      throw err; // unrelated extraction error — let it surface as-is
    }
    // Recovery path: re-inject the content script for this site.
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      throw new Error("Couldn't reach the page. Please reload the tab and try again.");
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: scriptsForSite(getSitePrefix(tab.url))
      });
    } catch (injectErr) {
      throw new Error("Couldn't reach the page. Please reload the tab and try again.");
    }
    try {
      return await sendExtractMessageOnce(tab.id);
    } catch (retryErr) {
      throw new Error("Couldn't reach the page. Please reload the tab and try again.");
    }
  }
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle extract button click.
 */
async function handleExtract() {
  try {
    setButtonState(false, 'Extracting...');
    setStatus('Starting extraction...', 'info');
    showProgress('Connecting to page...');

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !isSupportedSite(tab.url)) {
      setStatus('Please open a Gemini, Claude, or ChatGPT conversation first.', 'error');
      setButtonState(true);
      hideProgress();
      return;
    }

    // Send extract message to content script. If the content script
    // isn't loaded in the tab (e.g. tab was opened before the extension
    // was installed/reloaded), Chrome rejects with "Receiving end does
    // not exist". sendExtractMessage transparently re-injects the
    // content script and retries once before surfacing a friendly
    // recovery message (#139).
    showProgress('Extracting conversation...');

    const result = await sendExtractMessage(tab);

    if (!result.success) {
      setStatus(result.error || 'Extraction failed', 'error');
      setButtonState(true);
      hideProgress();
      return;
    }

    // Show extraction results
    const { data, images, warnings } = result;
    showResult(
      data.metadata.messageCount,
      data.metadata.imageCount,
      data.metadata.extractionErrors.length,
      data.metadata.scrollInfo
    );

    // Surface image-fetch failures explicitly (the bare error count
    // doesn't communicate what kind of failure it was). Counts only
    // image_fetch type errors — other extraction warnings appear via
    // the warnings array below (#141).
    const imageFetchFailures = (data.metadata.extractionErrors || [])
      .filter(e => e && e.type === 'image_fetch').length;
    showImageFetchWarning(imageFetchFailures);

    // Save to localStorage for persistence (popup may close during download).
    // Pass site so the next popup-open on a different site doesn't surface
    // these stats (#138).
    saveLastResult(data, getSitePrefix(tab.url));

    // Check size
    const estimatedSize = estimateExportSize(images || []);
    if (estimatedSize > 500 * 1024 * 1024) { // 500MB
      setStatus(`Warning: Large export (${formatBytes(estimatedSize)}). This may take a while.`, 'warning');
    }

    // Create zip
    showProgress('Creating zip file...');
    const zipBlob = await createZip(data, images || []);

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const title = sanitizeFilename(data.metadata.title);
    const sitePrefix = getSitePrefix(tab.url);
    const filename = `${sitePrefix}-${data.metadata.conversationId}-${title}-${timestamp}.zip`;

    // Download
    showProgress('Starting download...');
    downloadBlob(zipBlob, filename);

    // Update status
    hideProgress();
    if (warnings && warnings.length > 0) {
      setStatus(`Extraction complete with warnings: ${warnings.join(', ')}`, 'warning');
    } else {
      setStatus('Extraction complete! Check your downloads.', 'ready');
    }

    setButtonState(true);

  } catch (error) {
    console.error('Extraction error:', error);
    setStatus(`Error: ${error.message}`, 'error');
    setButtonState(true);
    hideProgress();
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

// Only set up event listeners if DOM elements exist (not in test environment loading)
const extractBtn = document.getElementById('extractBtn');
if (extractBtn) {
  extractBtn.addEventListener('click', handleExtract);

  // Determine active tab's site, then restore the last extraction's
  // stats ONLY if it was from the same site (#138). On an unsupported
  // page, disable the button and skip the restore entirely.
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || !tab.url || !isSupportedSite(tab.url)) {
      setStatus('Open a Gemini, Claude, or ChatGPT conversation to extract.', 'warning');
      setButtonState(false);
      return;
    }
    restoreLastResult(getSitePrefix(tab.url));
  });
}

// ============================================================================
// Exports for Testing
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isSupportedSite,
    getSitePrefix,
    sanitizeFilename,
    estimateExportSize,
    formatBytes,
    setStatus,
    showProgress,
    hideProgress,
    showResult,
    showImageFetchWarning,
    setButtonState,
    createZip,
    downloadBlob,
    handleExtract,
    saveLastResult,
    restoreLastResult,
    sendExtractMessage,
    scriptsForSite
  };
}
