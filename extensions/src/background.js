/**
 * Background service worker for Clio.
 * Handles download requests and extension lifecycle.
 *
 * LLD Reference: docs/reports/1/lld-clio.md
 */

/* global chrome */

// Listener stubs. Required by the manifest's background.service_worker
// declaration. No-op after #151 removed the debug console.log breadcrumbs
// that previously lived in these bodies.
chrome.runtime.onInstalled.addListener(() => {});
chrome.downloads.onChanged.addListener(() => {});

// ============================================================================
// Exports for Testing
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {};
}
