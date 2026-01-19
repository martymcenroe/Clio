/**
 * Clio Selector Discovery Script
 *
 * PURPOSE: Discover the actual DOM structure of Gemini conversations.
 * This is NOT a test - it's data collection for implementation.
 *
 * USAGE:
 * 1. Open a Gemini conversation with multiple messages
 * 2. Open DevTools (F12) → Console
 * 3. Paste this entire script and press Enter
 * 4. Copy the output and provide it to the developer
 */

(function() {
  console.log('=== CLIO SELECTOR DISCOVERY ===\n');

  const results = {
    timestamp: new Date().toISOString(),
    url: window.location.href,
    scrollContainers: [],
    messageContainers: [],
    loadingIndicators: [],
    userMessages: [],
    assistantMessages: []
  };

  // 1. Find all scrollable containers
  console.log('1. SCROLLABLE CONTAINERS:');
  document.querySelectorAll('*').forEach(el => {
    const style = getComputedStyle(el);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 100) {
      const info = {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: el.className ? el.className.split(' ').slice(0, 5) : [],
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        dataAttrs: Array.from(el.attributes)
          .filter(a => a.name.startsWith('data-'))
          .map(a => `${a.name}="${a.value}"`),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        selector: buildSelector(el)
      };
      results.scrollContainers.push(info);
      console.log(`  - ${info.selector} (scrollHeight: ${info.scrollHeight})`);
    }
  });

  // 2. Find message-like containers
  console.log('\n2. MESSAGE CONTAINERS (data-message-*, role="listitem", etc):');
  const messageSelectors = [
    '[data-message-author-role]',
    '[data-message-id]',
    '[role="listitem"]',
    '[data-turn-id]',
    '.message',
    '.conversation-turn'
  ];
  messageSelectors.forEach(sel => {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      console.log(`  - ${sel}: ${els.length} found`);
      results.messageContainers.push({ selector: sel, count: els.length });
    }
  });

  // 3. Find elements that look like user/assistant messages by content structure
  console.log('\n3. ROLE-BASED MESSAGE DETECTION:');
  document.querySelectorAll('*').forEach(el => {
    const role = el.getAttribute('data-message-author-role') ||
                 el.getAttribute('data-author-role') ||
                 el.getAttribute('data-role');
    if (role) {
      const info = { role, selector: buildSelector(el) };
      if (role === 'user' || role === 'human') {
        if (results.userMessages.length < 3) results.userMessages.push(info);
      } else if (role === 'model' || role === 'assistant' || role === 'bot') {
        if (results.assistantMessages.length < 3) results.assistantMessages.push(info);
      }
    }
  });
  console.log(`  User messages found: ${results.userMessages.length}`);
  console.log(`  Assistant messages found: ${results.assistantMessages.length}`);

  // 4. Find loading indicators
  console.log('\n4. LOADING INDICATORS:');
  const loadingSelectors = [
    '[aria-busy="true"]',
    '[role="progressbar"]',
    'mat-spinner',
    '.loading',
    '.spinner',
    '[data-loading]',
    'svg[class*="spin"]',
    '[class*="loading"]',
    '[class*="progress"]'
  ];
  loadingSelectors.forEach(sel => {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      console.log(`  - ${sel}: ${els.length} found`);
      results.loadingIndicators.push({ selector: sel, count: els.length });
    }
  });

  // 5. Test scroll behavior
  console.log('\n5. SCROLL TEST:');
  if (results.scrollContainers.length > 0) {
    const container = document.querySelector(results.scrollContainers[0].selector);
    if (container) {
      const originalScroll = container.scrollTop;
      container.scrollTop = 0;
      const moved = originalScroll !== container.scrollTop;
      container.scrollTop = originalScroll; // restore
      console.log(`  Container: ${results.scrollContainers[0].selector}`);
      console.log(`  Scroll test: ${moved ? 'WORKS' : 'FAILED - wrong container'}`);
      results.scrollTest = { selector: results.scrollContainers[0].selector, works: moved };
    }
  }

  // 6. Find thinking/reasoning sections
  console.log('\n6. THINKING/REASONING SECTIONS:');
  const thinkingSelectors = [
    '[class*="thinking"]',
    '[class*="reason"]',
    '[data-thinking]',
    'details',
    '[aria-expanded]'
  ];
  thinkingSelectors.forEach(sel => {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      console.log(`  - ${sel}: ${els.length} found`);
    }
  });

  // 7. Output JSON for developer
  console.log('\n=== COPY THIS JSON FOR DEVELOPER ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('=== END ===');

  function buildSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.getAttribute('role')) return `[role="${el.getAttribute('role')}"]`;
    if (el.getAttribute('data-message-author-role')) {
      return `[data-message-author-role="${el.getAttribute('data-message-author-role')}"]`;
    }
    const classes = el.className.split(' ').filter(c => c && !c.match(/^[a-z]{6,}$/i));
    if (classes.length > 0) return `${el.tagName.toLowerCase()}.${classes[0]}`;
    return el.tagName.toLowerCase();
  }

  return results;
})();
