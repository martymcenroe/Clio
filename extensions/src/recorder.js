/**
 * Content script for recorder.google.com
 * Automates bulk downloading of recordings.
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
      warnings: []
    });
    
    // Automatically start the process without needing a second click
    startAutomaticExtraction();
    return true;
  }
});

let statusBanner = null;

function showStatus(text) {
  if (!statusBanner) {
    statusBanner = document.createElement('div');
    statusBanner.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 300px;
      background: #1e1e1e;
      color: #fff;
      border: 1px solid #007bff;
      border-radius: 8px;
      padding: 16px;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
    `;
    document.body.appendChild(statusBanner);
  }
  statusBanner.innerHTML = `<strong>Clio Bulk Downloader</strong><br/><br/>${text}`;
}

async function autoScrollToBottom() {
  showStatus('Scrolling to load all older recordings...');
  let lastHeight = 0;
  let attempts = 0;
  
  while (attempts < 5) {
    // Scroll the main content area. Google Recorder might have a specific scroll container.
    // We try to scroll document.scrollingElement, document.body, or look for a scrollable div.
    const scrollContainers = [
      document.scrollingElement,
      document.body,
      ...Array.from(document.querySelectorAll('div')).filter(div => {
        const style = window.getComputedStyle(div);
        return style.overflowY === 'auto' || style.overflowY === 'scroll';
      })
    ];

    let scrolled = false;
    for (const container of scrollContainers) {
      if (container && container.scrollHeight > container.clientHeight) {
        container.scrollTo(0, container.scrollHeight);
        scrolled = true;
      }
    }

    if (!scrolled) {
      window.scrollTo(0, document.body.scrollHeight);
    }

    await new Promise(r => setTimeout(r, 1500)); // wait for network load
    
    const newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) {
      attempts++;
    } else {
      attempts = 0;
      lastHeight = newHeight;
    }
  }
}

async function startAutomaticExtraction() {
  if (document.getElementById('clio-recorder-processing')) return;
  document.body.insertAdjacentHTML('beforeend', '<div id="clio-recorder-processing"></div>');
  
  try {
    // 1. Auto-scroll first
    await autoScrollToBottom();
    
    // 2. Extract
    await runBulkDownload();
    
    showStatus('✅ Finished processing all recordings! You may close this tab.');
    setTimeout(() => {
      if (statusBanner) statusBanner.remove();
    }, 10000);
  } catch (e) {
    showStatus('❌ Error: ' + e.message);
  }
}

async function runBulkDownload() {
  showStatus('Scanning for recordings...');
  
  const rows = Array.from(document.querySelectorAll('div[role="row"]'));
  
  if (rows.length === 0) {
    throw new Error('No recordings found. Make sure you are on the list view.');
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    showStatus(`Downloading ${i + 1} of ${rows.length}...`);
    
    row.click();
    await new Promise(r => setTimeout(r, 1500));
    
    const moreBtn = document.querySelector('button[aria-label="More options"], button[aria-label="Options"]');
    if (moreBtn) {
      moreBtn.click();
      await new Promise(r => setTimeout(r, 500));
      
      const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], li[role="menuitem"]'));
      const downloadAudioBtn = menuItems.find(el => el.textContent.toLowerCase().includes('download audio'));
      
      if (downloadAudioBtn) {
        downloadAudioBtn.click();
      } else {
        console.warn('Could not find Download Audio button for item', i);
      }
    } else {
      console.warn('Could not find More Options button for item', i);
    }
    
    await new Promise(r => setTimeout(r, 1000));
    
    const backBtn = document.querySelector('button[aria-label="Back"], button[aria-label="Navigate up"]');
    if (backBtn) {
      backBtn.click();
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
}
