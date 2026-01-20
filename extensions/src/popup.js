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
 */
function saveLastResult(data) {
  try {
    const lastResult = {
      messageCount: data.metadata.messageCount,
      imageCount: data.metadata.imageCount,
      errorCount: data.metadata.extractionErrors.length,
      scrollInfo: data.metadata.scrollInfo,
      title: data.metadata.title,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('clio_lastResult', JSON.stringify(lastResult));
  } catch (e) {
    // Ignore localStorage errors
  }
}

/**
 * Restore last extraction result from localStorage if available.
 */
function restoreLastResult() {
  try {
    const saved = localStorage.getItem('clio_lastResult');
    if (saved) {
      const lastResult = JSON.parse(saved);
      // Only show if less than 1 hour old
      const age = Date.now() - new Date(lastResult.timestamp).getTime();
      if (age < 60 * 60 * 1000) {
        showResult(
          lastResult.messageCount,
          lastResult.imageCount,
          lastResult.errorCount,
          lastResult.scrollInfo,
          true // isLastResult
        );
        setStatus(`Last: ${lastResult.title || 'Untitled'}`, 'info');
        return true;
      }
    }
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

    if (!tab || !tab.url || !tab.url.includes('gemini.google.com')) {
      setStatus('Please open a Gemini conversation first.', 'error');
      setButtonState(true);
      hideProgress();
      return;
    }

    // Send extract message to content script
    showProgress('Extracting conversation...');

    const result = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'extract' }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });

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

    // Save to localStorage for persistence (popup may close during download)
    saveLastResult(data);

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
    const filename = `gemini-${data.metadata.conversationId}-${title}-${timestamp}.zip`;

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

  // Restore last extraction results if available (for when popup was closed during save)
  restoreLastResult();

  // Check if we're on a Gemini page on load
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || !tab.url || !tab.url.includes('gemini.google.com')) {
      setStatus('Open a Gemini conversation to extract.', 'warning');
      setButtonState(false);
    }
  });
}

// ============================================================================
// Exports for Testing
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeFilename,
    estimateExportSize,
    formatBytes,
    setStatus,
    showProgress,
    hideProgress,
    showResult,
    setButtonState,
    createZip,
    downloadBlob,
    handleExtract,
    saveLastResult,
    restoreLastResult
  };
}
