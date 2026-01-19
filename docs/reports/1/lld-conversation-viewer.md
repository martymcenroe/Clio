# LLD: Conversation Viewer Tool

**Issue:** #1
**Status:** Approved
**Author:** Claude
**Date:** 2026-01-19

## Overview

Single-file HTML viewer for browsing harvested Gemini conversations. Optimized for rapid scrolling through hundreds of conversations with click-to-copy functionality.

## Architecture

### Source Files (Development)

```
viewer/
├── viewer-logic.js       <- Pure functions (unit tested)
├── viewer.template.html  <- HTML + CSS + UI code
├── build.js              <- Combines logic + template
└── viewer.html           <- Generated artifact (do not edit)
```

### Build Process

```
viewer-logic.js ──┐
                  ├──> build.js ──> viewer.html
viewer.template.html ─┘
```

**Command:** `npm run build:viewer`

### Generated File Structure

```
viewer.html (generated)
├── <style>           (~200 lines) - All CSS
├── <script>          (~400 lines) - Injected logic + UI code
└── <body>            (~50 lines)  - HTML skeleton
```

**Rationale:**
- Zero dependencies in output, works offline, portable
- Build step ensures unit-tested logic is injected into production
- Eliminates manual sync risk between test and production code

## Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  User drags │ --> │  FileReader  │ --> │  JSON.parse │ --> │  Validate    │
│  JSON files │     │  .text()     │     │             │     │  structure   │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
                                                                    │
                    ┌──────────────┐     ┌─────────────┐            │
                    │  Render      │ <-- │  Store in   │ <----------┘
                    │  bubbles     │     │  state[]    │
                    └──────────────┘     └─────────────┘
```

## State Management

```javascript
const AppState = {
  conversations: [],      // Array of parsed conversation objects
  activeIndex: 0,         // Currently selected conversation index
  compactMode: true,      // Global compact/expand toggle
  expandedBubbles: new Set()  // Individual bubble expansion overrides
};
```

## Component Breakdown

### 1. Drop Zone & File Loader

```javascript
// DOM Structure (MVP: JSON only, ZIP deferred to Phase 2)
<div id="drop-zone" class="drop-zone">
  <p>Drop JSON files here</p>
  <input type="file" id="file-input" multiple accept=".json" />
  <button id="browse-btn">Browse Files</button>
</div>

// Event Handlers
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('drop', handleDrop);
fileInput.addEventListener('change', handleFileSelect);

// Core Loading Function (MVP: JSON only, ZIP deferred to Phase 2)
async function loadFiles(fileList) {
  const results = { loaded: [], failed: [] };

  for (const file of fileList) {
    try {
      // File size checks
      if (file.size > FILE_SIZE_LIMIT) {
        throw new Error(`File exceeds 20MB limit (${formatSize(file.size)})`);
      }
      if (file.size > FILE_SIZE_WARNING) {
        showToast(`Large file: ${file.name} (${formatSize(file.size)})`, 'warning');
      }

      // MVP: JSON only
      if (!file.name.endsWith('.json')) {
        throw new Error('Only .json files supported (ZIP support in Phase 2)');
      }

      const json = JSON.parse(await file.text());
      validateConversation(json);
      results.loaded.push({ filename: file.name, data: json });
    } catch (err) {
      results.failed.push({ filename: file.name, error: err.message });
      showToast(`Failed: ${file.name} - ${err.message}`, 'error');
      console.error(`Failed to load ${file.name}:`, err);
    }
  }

  if (results.loaded.length > 0) {
    showToast(`Loaded ${results.loaded.length} conversation(s)`, 'success');
    AppState.conversations.push(...results.loaded.map(r => r.data));
    renderSidebar();
    selectConversation(0);
  }

  return results;
}
```

### 2. Validation

```javascript
function validateConversation(json) {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid JSON: not an object');
  }
  if (!json.metadata || typeof json.metadata !== 'object') {
    throw new Error('Missing or invalid metadata');
  }
  if (!Array.isArray(json.turns)) {
    throw new Error('Missing or invalid turns array');
  }
  for (let i = 0; i < json.turns.length; i++) {
    const turn = json.turns[i];
    if (!turn.role || !['user', 'assistant'].includes(turn.role)) {
      throw new Error(`Turn ${i}: invalid role "${turn.role}"`);
    }
    if (typeof turn.content !== 'string') {
      throw new Error(`Turn ${i}: content must be string`);
    }
  }
  return true;
}
```

### 3. Sidebar (Conversation List)

```javascript
// DOM Structure
<aside id="sidebar">
  <h2>Conversations (<span id="conv-count">0</span>)</h2>
  <ul id="conv-list"></ul>
</aside>

// Render Function
function renderSidebar() {
  const list = document.getElementById('conv-list');
  list.innerHTML = '';

  AppState.conversations.forEach((conv, index) => {
    const li = document.createElement('li');
    li.className = index === AppState.activeIndex ? 'active' : '';
    li.textContent = conv.metadata.title || `Conversation ${index + 1}`;
    li.dataset.index = index;
    li.addEventListener('click', () => selectConversation(index));
    list.appendChild(li);
  });

  document.getElementById('conv-count').textContent = AppState.conversations.length;
}
```

### 4. Conversation Panel (Bubble Renderer)

```javascript
// DOM Structure
<main id="conversation-panel">
  <header id="conv-header">
    <h1 id="conv-title"></h1>
    <span id="conv-meta"></span>
  </header>
  <div id="bubbles-container"></div>
</main>

// Render Function
function renderConversation(conv) {
  const container = document.getElementById('bubbles-container');
  container.innerHTML = '';

  document.getElementById('conv-title').textContent = conv.metadata.title || 'Untitled';
  document.getElementById('conv-meta').textContent =
    `${conv.metadata.turnCount} turns · Extracted ${formatDate(conv.metadata.extractedAt)}`;

  conv.turns.forEach((turn, index) => {
    const bubble = createBubble(turn, index);
    container.appendChild(bubble);
  });
}

function createBubble(turn, index) {
  const bubble = document.createElement('div');
  const isCompact = AppState.compactMode && !AppState.expandedBubbles.has(index);

  bubble.className = `bubble ${turn.role} ${isCompact ? 'compact' : ''}`;
  bubble.dataset.index = index;
  bubble.dataset.rawContent = turn.content;

  // Role label
  const roleLabel = document.createElement('div');
  roleLabel.className = 'role-label';
  roleLabel.textContent = turn.role === 'user' ? 'You' : 'Gemini';
  bubble.appendChild(roleLabel);

  // Content (safe: textContent only)
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = turn.content;
  bubble.appendChild(content);

  // Expand/collapse toggle (only in compact mode)
  if (AppState.compactMode) {
    const toggle = document.createElement('button');
    toggle.className = 'expand-toggle';
    toggle.textContent = isCompact ? '▼ Expand' : '▲ Collapse';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBubble(index);
    });
    bubble.appendChild(toggle);
  }

  // Click to copy
  bubble.addEventListener('click', () => copyBubbleContent(bubble));

  return bubble;
}
```

### 5. Click-to-Copy

```javascript
async function copyBubbleContent(bubble) {
  const content = bubble.dataset.rawContent;

  try {
    await navigator.clipboard.writeText(content);

    // Visual feedback
    bubble.classList.add('copied');
    showToast('Copied to clipboard');

    setTimeout(() => bubble.classList.remove('copied'), 300);
  } catch (err) {
    console.error('Copy failed:', err);
    showToast('Failed to copy', 'error');
  }
}
```

### 6. Toast Notifications

```javascript
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  document.getElementById('toast-container').appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));

  // Auto-remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
```

### 7. Global Controls

```javascript
// DOM Structure
<div id="controls">
  <button id="toggle-mode">Compact ↔ Full</button>
</div>

// Handler
document.getElementById('toggle-mode').addEventListener('click', () => {
  AppState.compactMode = !AppState.compactMode;
  AppState.expandedBubbles.clear();
  renderConversation(AppState.conversations[AppState.activeIndex]);
});
```

## CSS Architecture

### Layout (Flexbox)

```css
body {
  display: flex;
  height: 100vh;
  margin: 0;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

#sidebar {
  width: 280px;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  flex-shrink: 0;
}

#conversation-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

#bubbles-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
```

### Bubble Styles

```css
.bubble {
  max-width: 80%;
  padding: 12px 16px;
  margin: 8px 0;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.bubble.user {
  margin-left: auto;
  background: #e3f2fd;
  border-bottom-right-radius: 4px;
}

.bubble.assistant {
  margin-right: auto;
  background: #f5f5f5;
  border-bottom-left-radius: 4px;
}

.bubble:hover {
  filter: brightness(0.97);
}

.bubble.copied {
  animation: flash 0.3s ease;
}

@keyframes flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
```

### Compact Mode

```css
.bubble.compact .content {
  max-height: 7.5em;  /* ~5 lines at 1.5 line-height */
  overflow: hidden;
  position: relative;
}

.bubble.compact .content::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2em;
  background: linear-gradient(transparent, inherit);
  pointer-events: none;
}

.content {
  white-space: pre-wrap;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 14px;
  line-height: 1.5;
}
```

### Toast Styles

```css
#toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
}

.toast {
  padding: 12px 20px;
  margin-top: 8px;
  border-radius: 8px;
  background: #323232;
  color: white;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.3s ease;
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}

.toast-error { background: #d32f2f; }
.toast-success { background: #388e3c; }
```

## File Structure Output

```
viewer.html (single file, ~650 lines total)
│
├─ <!DOCTYPE html>
├─ <html>
│  ├─ <head>
│  │  ├─ <meta charset="UTF-8">
│  │  ├─ <title>Clio Viewer</title>
│  │  └─ <style> ... 200 lines ... </style>
│  │
│  └─ <body>
│     ├─ <div id="drop-zone">...</div>
│     ├─ <aside id="sidebar">...</aside>
│     ├─ <main id="conversation-panel">...</main>
│     ├─ <div id="toast-container"></div>
│     └─ <script> ... 400 lines ... </script>
│
└─ </html>
```

## Test Fixtures Required

Create these files in `test/fixtures/`:

### `conversation_fixture.json`
```json
{
  "metadata": {
    "conversationId": "test-fixture-001",
    "title": "Test Conversation for Viewer",
    "extractedAt": "2026-01-19T12:00:00.000Z",
    "url": "https://gemini.google.com/app/test-fixture-001",
    "turnCount": 4,
    "imageCount": 0,
    "extractionErrors": [],
    "partialSuccess": false
  },
  "turns": [
    {
      "index": 0,
      "role": "user",
      "content": "Hello! Can you help me understand recursion?",
      "thinking": null,
      "attachments": []
    },
    {
      "index": 1,
      "role": "assistant",
      "content": "Of course! Recursion is when a function calls itself.\n\nHere's a simple example:\n\n```python\ndef factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n```\n\nThe key elements are:\n1. Base case (n <= 1)\n2. Recursive case (calls itself with smaller input)",
      "thinking": null,
      "attachments": []
    },
    {
      "index": 2,
      "role": "user",
      "content": "That makes sense! What about tail recursion?",
      "thinking": null,
      "attachments": []
    },
    {
      "index": 3,
      "role": "assistant",
      "content": "Tail recursion is when the recursive call is the last operation in the function.\n\n```python\ndef factorial_tail(n, accumulator=1):\n    if n <= 1:\n        return accumulator\n    return factorial_tail(n - 1, n * accumulator)\n```\n\nSome languages optimize tail recursion to avoid stack overflow.",
      "thinking": null,
      "attachments": []
    }
  ]
}
```

### `broken_fixture.json`
```json
{
  "metadata": {
    "title": "Broken Fixture"
  },
  "turns": "not an array"
}
```

## Security Considerations

| Risk | Mitigation |
|------|------------|
| XSS from malicious content | `textContent` only, no `innerHTML` |
| Data exfiltration | No network requests, fully offline |
| Prototype pollution | Validate JSON structure before use |

## Browser Compatibility

| Feature | Chrome | Firefox | Edge | Safari |
|---------|--------|---------|------|--------|
| Clipboard API | 66+ | 63+ | 79+ | 13.1+ |
| Drag & Drop | Yes | Yes | Yes | Yes |
| CSS Grid/Flex | Yes | Yes | Yes | Yes |
| FileReader | Yes | Yes | Yes | Yes |

## Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| ZIP Support in MVP? | **Deferred to Phase 2** | Adds ~90KB dependency, breaks "lightweight" goal |
| Thinking sections display? | **Collapsed by default** | Matches compact mode philosophy; toggle to expand |
| Max file size limit? | **5MB warning, 20MB hard limit** | `JSON.parse` is synchronous/blocking; prevents browser freeze |

### File Size Handling

```javascript
const FILE_SIZE_WARNING = 5 * 1024 * 1024;  // 5MB
const FILE_SIZE_LIMIT = 20 * 1024 * 1024;   // 20MB

async function loadFile(file) {
  if (file.size > FILE_SIZE_LIMIT) {
    throw new Error(`File exceeds 20MB limit (${formatSize(file.size)})`);
  }
  if (file.size > FILE_SIZE_WARNING) {
    showToast(`Large file: ${file.name} (${formatSize(file.size)})`, 'warning');
  }
  // ... continue loading
}
```

## Testing Strategy

### Unit Tests (Jest + JSDOM)

Core logic is extracted into testable pure functions. Tests run via `npm test`.

**Test file:** `test/viewer.test.js`

```javascript
const { validateConversation, formatDate, formatSize } = require('./viewer-logic');

describe('validateConversation', () => {
  test('accepts valid conversation', () => {
    const valid = require('./fixtures/conversation_fixture.json');
    expect(() => validateConversation(valid)).not.toThrow();
  });

  test('rejects missing metadata', () => {
    expect(() => validateConversation({ turns: [] }))
      .toThrow('Missing or invalid metadata');
  });

  test('rejects non-array turns', () => {
    const broken = require('./fixtures/broken_fixture.json');
    expect(() => validateConversation(broken))
      .toThrow('Missing or invalid turns array');
  });

  test('rejects invalid role', () => {
    const badRole = {
      metadata: { title: 'test' },
      turns: [{ role: 'unknown', content: 'hello' }]
    };
    expect(() => validateConversation(badRole))
      .toThrow('Turn 0: invalid role');
  });

  test('handles empty turns array', () => {
    const empty = { metadata: { title: 'Empty' }, turns: [] };
    expect(() => validateConversation(empty)).not.toThrow();
  });

  test('rejects missing content', () => {
    const noContent = {
      metadata: { title: 'test' },
      turns: [{ role: 'user' }]
    };
    expect(() => validateConversation(noContent))
      .toThrow('Turn 0: content must be string');
  });
});

describe('formatSize', () => {
  test('formats bytes', () => expect(formatSize(500)).toBe('500 B'));
  test('formats KB', () => expect(formatSize(1024)).toBe('1.0 KB'));
  test('formats MB', () => expect(formatSize(5242880)).toBe('5.0 MB'));
});
```

### E2E Tests (Playwright)

Integration tests verify full user flows in real browsers.

**Test file:** `test/viewer.e2e.test.js`

```javascript
const { test, expect } = require('@playwright/test');

test.describe('Conversation Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('file://' + process.cwd() + '/viewer.html');
  });

  test('loads valid JSON via file input', async ({ page }) => {
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles('test/fixtures/conversation_fixture.json');

    await expect(page.locator('#conv-list li')).toHaveCount(1);
    await expect(page.locator('#conv-title')).toHaveText('Test Conversation for Viewer');
  });

  test('displays error toast for invalid JSON', async ({ page }) => {
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles('test/fixtures/broken_fixture.json');

    await expect(page.locator('.toast-error')).toBeVisible();
    await expect(page.locator('.toast-error')).toContainText('failed to load');
  });

  test('click bubble copies content', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles('test/fixtures/conversation_fixture.json');

    const firstBubble = page.locator('.bubble').first();
    await firstBubble.click();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('help me understand recursion');
  });

  test('compact mode truncates content', async ({ page }) => {
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles('test/fixtures/conversation_fixture.json');

    const bubble = page.locator('.bubble.compact').first();
    const contentHeight = await bubble.locator('.content').evaluate(el =>
      parseFloat(getComputedStyle(el).maxHeight)
    );
    expect(contentHeight).toBeLessThanOrEqual(120); // ~7.5em
  });

  test('toggle expands all bubbles', async ({ page }) => {
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles('test/fixtures/conversation_fixture.json');

    await page.click('#toggle-mode');
    await expect(page.locator('.bubble.compact')).toHaveCount(0);
  });
});
```

### Test Fixtures

Located in `test/fixtures/`:

| Fixture | Purpose |
|---------|---------|
| `conversation_fixture.json` | Valid 4-turn conversation |
| `broken_fixture.json` | Invalid: turns is string not array |
| `empty_turns_fixture.json` | Edge case: valid but 0 turns |
| `large_content_fixture.json` | Single turn with 10KB content |
| `missing_metadata_fixture.json` | Invalid: no metadata object |

### CI Integration

```yaml
# .github/workflows/test.yml
name: Test Viewer
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test
      - run: npx playwright install --with-deps
      - run: npx playwright test
```

## Error Reporting (Fail-Safe UI)

### Batch Load Feedback

When loading multiple files, each failure gets its own toast notification:

```javascript
async function loadFiles(fileList) {
  const results = { loaded: [], failed: [] };

  for (const file of fileList) {
    try {
      // ... validation and parsing
      results.loaded.push({ filename: file.name, data: json });
    } catch (err) {
      results.failed.push({ filename: file.name, error: err.message });
      // Individual error toast per failed file
      showToast(`Failed: ${file.name} - ${err.message}`, 'error');
      console.error(`[Viewer] Failed to load ${file.name}:`, err);
    }
  }

  // Summary toast for successful loads
  if (results.loaded.length > 0) {
    showToast(`Loaded ${results.loaded.length} conversation(s)`, 'success');
  }

  return results;
}
```

### Toast Queue (Prevents Overlap)

```javascript
const toastQueue = [];
let toastActive = false;

function showToast(message, type = 'info') {
  toastQueue.push({ message, type });
  if (!toastActive) processToastQueue();
}

function processToastQueue() {
  if (toastQueue.length === 0) {
    toastActive = false;
    return;
  }
  toastActive = true;
  const { message, type } = toastQueue.shift();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.getElementById('toast-container').appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
      processToastQueue(); // Next toast
    }, 300);
  }, 2000);
}
```

## Acceptance Checklist

### Automated Tests (CI Gate)
- [ ] Unit tests pass (`npm test`)
- [ ] E2E tests pass (`npx playwright test`)
- [ ] All test fixtures load without error

### Functional Requirements
- [ ] Single HTML file, no external dependencies
- [ ] All processing client-side, no network requests
- [ ] Drag-drop and file picker both work
- [ ] Fail-safe: invalid files show individual error toasts, valid files load
- [ ] File size: warning at 5MB, hard reject at 20MB
- [ ] Sidebar lists conversations by title
- [ ] Click conversation switches view
- [ ] Content rendered via textContent (XSS safe)
- [ ] User bubbles: right-aligned, blue
- [ ] Assistant bubbles: left-aligned, gray
- [ ] Compact mode: 5 lines max with fade
- [ ] Thinking sections: collapsed by default with toggle
- [ ] Click bubble: copies content, shows toast
- [ ] Global toggle: compact ↔ full
- [ ] Works in Chrome, Firefox, Edge
