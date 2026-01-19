/**
 * Background service worker for Clio.
 * Handles download requests and extension lifecycle.
 *
 * LLD Reference: docs/reports/1/lld-clio.md
 */

/* global chrome */

// Log extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Clio installed/updated:', details.reason);
});

// Handle download completion notifications (optional)
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    console.log('Download completed:', delta.id);
  }
});
