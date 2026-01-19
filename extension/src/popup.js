/**
 * Popup script for Clio.
 * Handles UI and download logic.
 *
 * LLD Reference: docs/reports/1/lld-clio.md
 */

/* global chrome */

// ============================================================================
// UI Elements
// ============================================================================

const statusEl = document.getElementById('status');
const extractBtn = document.getElementById('extractBtn');
const progressEl = document.getElementById('progress');
const progressText = document.getElementById('progressText');
const resultEl = document.getElementById('result');
const turnCountEl = document.getElementById('turnCount');
const imageCountEl = document.getElementById('imageCount');
const errorCountEl = document.getElementById('errorCount');

// ============================================================================
// UI Helpers
// ============================================================================

function setStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function showProgress(message) {
  progressEl.classList.add('visible');
  progressText.textContent = message;
}

function hideProgress() {
  progressEl.classList.remove('visible');
}

function showResult(turns, images, errors) {
  resultEl.classList.add('visible');
  turnCountEl.textContent = turns;
  imageCountEl.textContent = images;
  errorCountEl.textContent = errors;
}

function setButtonState(enabled, text = 'Extract Conversation') {
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
  // Dynamically import JSZip from CDN if not available
  if (typeof JSZip === 'undefined') {
    await loadJSZip();
  }

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

/**
 * Load JSZip library dynamically.
 */
function loadJSZip() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load JSZip'));
    document.head.appendChild(script);
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
      data.metadata.turnCount,
      data.metadata.imageCount,
      data.metadata.extractionErrors.length
    );

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

extractBtn.addEventListener('click', handleExtract);

// Check if we're on a Gemini page on load
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !tab.url || !tab.url.includes('gemini.google.com')) {
    setStatus('Open a Gemini conversation to extract.', 'warning');
    setButtonState(false);
  }
});
