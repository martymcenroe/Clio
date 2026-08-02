/**
 * Content script for recorder.google.com
 * Injects a control panel to automate bulk downloading of recordings.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    // Return a dummy success to Clio's popup so it doesn't fail.
    // The actual work happens in the injected UI.
    sendResponse({
      success: true,
      data: {
        metadata: {
          conversationId: 'recorder-bulk',
          title: 'Bulk Download',
          extractionErrors: [],
          messageCount: 0,
          imageCount: 0
        }
      },
      images: [],
      warnings: ["Check the page for the Clio Recorder Bulk Download panel."]
    });
    
    injectControlPanel();
    return true;
  }
});

function injectControlPanel() {
  if (document.getElementById('clio-recorder-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'clio-recorder-panel';
  panel.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 300px;
    background: #1e1e1e;
    color: #fff;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 16px;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    font-family: system-ui, -apple-system, sans-serif;
  `;

  panel.innerHTML = `
    <h3 style="margin: 0 0 12px; font-size: 16px; border-bottom: 1px solid #444; padding-bottom: 8px;">Clio Bulk Downloader</h3>
    <div id="clio-recorder-status" style="font-size: 13px; margin-bottom: 12px; color: #aaa;">
      Ready. Scroll down to load all recordings, then click Start.
    </div>
    <button id="clio-recorder-start" style="
      width: 100%; padding: 8px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
    ">Start Bulk Download</button>
    <button id="clio-recorder-close" style="
      width: 100%; padding: 8px; background: #444; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 8px;
    ">Close Panel</button>
  `;

  document.body.appendChild(panel);

  document.getElementById('clio-recorder-close').addEventListener('click', () => {
    panel.remove();
  });

  document.getElementById('clio-recorder-start').addEventListener('click', async () => {
    const btn = document.getElementById('clio-recorder-start');
    const status = document.getElementById('clio-recorder-status');
    btn.disabled = true;
    btn.style.background = '#555';
    
    try {
      await runBulkDownload(status);
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    }
    
    btn.disabled = false;
    btn.style.background = '#007bff';
  });
}

async function runBulkDownload(statusEl) {
  statusEl.textContent = 'Scanning for recordings...';
  
  // Strategy: Google Recorder list items usually have role="row" or specific class names.
  // We can look for divs that have an aria-label containing "Duration" or similar.
  // Alternatively, just finding all list items by looking at the structure.
  
  // Let's use a broad selector that targets interactive elements in the main list.
  // Often they are role="row" or elements inside a main content area.
  const rows = Array.from(document.querySelectorAll('div[role="row"]'));
  
  if (rows.length === 0) {
    statusEl.textContent = 'No recordings found. Make sure you are on the list view.';
    return;
  }

  statusEl.textContent = \`Found \${rows.length} recordings. Starting download loop...\`;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    statusEl.textContent = \`Processing \${i + 1} of \${rows.length}...\`;
    
    // Click the row to open the detail view
    row.click();
    
    // Wait for the detail view to load
    await new Promise(r => setTimeout(r, 1500));
    
    // Now we need to find the "More options" button (three dots)
    // It usually has an aria-label="More options" or similar
    const moreBtn = document.querySelector('button[aria-label="More options"], button[aria-label="Options"]');
    if (moreBtn) {
      moreBtn.click();
      await new Promise(r => setTimeout(r, 500)); // Wait for menu to open
      
      // Look for "Download audio" menu item
      const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], li[role="menuitem"]'));
      const downloadAudioBtn = menuItems.find(el => el.textContent.toLowerCase().includes('download audio'));
      
      if (downloadAudioBtn) {
        downloadAudioBtn.click();
        statusEl.textContent = \`Triggered download \${i + 1}...\`;
      } else {
        console.warn('Could not find Download Audio button for item', i);
      }
    } else {
      console.warn('Could not find More Options button for item', i);
    }
    
    // Wait for download to trigger, then go back
    await new Promise(r => setTimeout(r, 1000));
    
    // Find the back button to return to the list
    const backBtn = document.querySelector('button[aria-label="Back"], button[aria-label="Navigate up"]');
    if (backBtn) {
      backBtn.click();
    } else {
      // Fallback: press Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
    
    // Wait for list to reload
    await new Promise(r => setTimeout(r, 1000));
  }
  
  statusEl.textContent = \`Finished processing \${rows.length} recordings!\`;
}
