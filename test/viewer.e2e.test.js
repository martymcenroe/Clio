/**
 * E2E tests for Clio Viewer
 * Run with: npx playwright test
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const VIEWER_PATH = path.resolve(__dirname, '../viewer/viewer.html');
const FIXTURES_PATH = path.resolve(__dirname, 'fixtures');

test.describe('Clio Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${VIEWER_PATH}`);
  });

  test.describe('Initial State', () => {
    test('shows empty state on load', async ({ page }) => {
      await expect(page.locator('#empty-state')).toBeVisible();
      await expect(page.locator('#conv-count')).toHaveText('0');
      await expect(page.locator('#conversation-panel')).not.toHaveClass(/visible/);
    });

    test('has correct title', async ({ page }) => {
      await expect(page).toHaveTitle('Clio Viewer');
    });

    test('shows browse button in empty state', async ({ page }) => {
      await expect(page.locator('#empty-browse-btn')).toBeVisible();
    });
  });

  test.describe('File Loading', () => {
    test('loads valid JSON via file input', async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles(path.join(FIXTURES_PATH, 'conversation_fixture.json'));

      // Check sidebar
      await expect(page.locator('#conv-list li')).toHaveCount(1);
      await expect(page.locator('#conv-count')).toHaveText('1');

      // Check conversation panel
      await expect(page.locator('#conversation-panel')).toHaveClass(/visible/);
      await expect(page.locator('#conv-title')).toHaveText('Test Conversation for Viewer');
    });

    test('displays success toast on valid load', async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles(path.join(FIXTURES_PATH, 'conversation_fixture.json'));

      await expect(page.locator('.toast-success')).toBeVisible();
      await expect(page.locator('.toast-success')).toContainText('Loaded 1 conversation');
    });

    test('displays error toast for invalid JSON', async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles(path.join(FIXTURES_PATH, 'broken_fixture.json'));

      await expect(page.locator('.toast-error')).toBeVisible();
      await expect(page.locator('.toast-error')).toContainText('Failed');

      // Should not add to sidebar
      await expect(page.locator('#conv-count')).toHaveText('0');
    });

    test('displays error toast for missing metadata', async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles(path.join(FIXTURES_PATH, 'missing_metadata_fixture.json'));

      await expect(page.locator('.toast-error')).toBeVisible();
      await expect(page.locator('.toast-error')).toContainText('metadata');
    });

    test('loads multiple files at once', async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles([
        path.join(FIXTURES_PATH, 'conversation_fixture.json'),
        path.join(FIXTURES_PATH, 'empty_turns_fixture.json'),
        path.join(FIXTURES_PATH, 'large_content_fixture.json')
      ]);

      await expect(page.locator('#conv-list li')).toHaveCount(3);
      await expect(page.locator('#conv-count')).toHaveText('3');
    });

    test('handles empty turns conversation', async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles(path.join(FIXTURES_PATH, 'empty_turns_fixture.json'));

      await expect(page.locator('#conv-title')).toHaveText('Empty Conversation');
      await expect(page.locator('.bubble')).toHaveCount(0);
    });
  });

  test.describe('Bubble Display', () => {
    test.beforeEach(async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles(path.join(FIXTURES_PATH, 'conversation_fixture.json'));
    });

    test('shows correct number of bubbles', async ({ page }) => {
      await expect(page.locator('.bubble')).toHaveCount(4);
    });

    test('user bubbles have correct class', async ({ page }) => {
      await expect(page.locator('.bubble.user')).toHaveCount(2);
    });

    test('assistant bubbles have correct class', async ({ page }) => {
      await expect(page.locator('.bubble.assistant')).toHaveCount(2);
    });

    test('bubbles display role labels', async ({ page }) => {
      const userLabels = page.locator('.bubble.user .role-label');
      const assistantLabels = page.locator('.bubble.assistant .role-label');

      await expect(userLabels.first()).toHaveText('You');
      await expect(assistantLabels.first()).toHaveText('Gemini');
    });

    test('bubbles display content', async ({ page }) => {
      const firstBubble = page.locator('.bubble').first();
      await expect(firstBubble.locator('.content')).toContainText('help me understand recursion');
    });
  });

  test.describe('Compact Mode', () => {
    test.beforeEach(async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles(path.join(FIXTURES_PATH, 'large_content_fixture.json'));
    });

    test('starts in compact mode', async ({ page }) => {
      await expect(page.locator('.bubble.compact')).toHaveCount(1);
    });

    test('compact mode truncates content', async ({ page }) => {
      const content = page.locator('.bubble.compact .content');
      const box = await content.boundingBox();
      // Max height is 7.5em (~120px at default font size)
      expect(box.height).toBeLessThanOrEqual(150);
    });

    test('shows expand toggle in compact mode', async ({ page }) => {
      await expect(page.locator('.expand-toggle')).toBeVisible();
      await expect(page.locator('.expand-toggle')).toHaveText('▼ Show more');
    });

    test('clicking expand toggle expands bubble', async ({ page }) => {
      await page.locator('.expand-toggle').click();
      await expect(page.locator('.bubble.compact')).toHaveCount(0);
      await expect(page.locator('.expand-toggle')).toHaveText('▲ Show less');
    });

    test('global toggle switches to full mode', async ({ page }) => {
      await page.locator('#toggle-mode').click();
      await expect(page.locator('.bubble.compact')).toHaveCount(0);
      await expect(page.locator('#toggle-mode')).toHaveText('Full Mode');
    });

    test('global toggle switches back to compact mode', async ({ page }) => {
      // Switch to full mode
      await page.locator('#toggle-mode').click();
      // Switch back to compact
      await page.locator('#toggle-mode').click();
      await expect(page.locator('.bubble.compact')).toHaveCount(1);
      await expect(page.locator('#toggle-mode')).toHaveText('Compact Mode');
    });
  });

  test.describe('Click to Copy', () => {
    // Skip clipboard tests on Firefox due to permission limitations
    test.beforeEach(async ({ page, context, browserName }) => {
      test.skip(browserName === 'firefox', 'Firefox does not support clipboard permissions');
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles(path.join(FIXTURES_PATH, 'conversation_fixture.json'));
    });

    test('clicking bubble copies content to clipboard', async ({ page }) => {
      const firstBubble = page.locator('.bubble').first();
      await firstBubble.click();

      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).toContain('help me understand recursion');
    });

    test('shows toast on copy', async ({ page }) => {
      const firstBubble = page.locator('.bubble').first();
      await firstBubble.click();

      await expect(page.locator('.toast')).toContainText('Copied to clipboard');
    });

    test('bubble flashes on copy', async ({ page }) => {
      const firstBubble = page.locator('.bubble').first();
      await firstBubble.click();

      // Check that copied class is applied (animation)
      await expect(firstBubble).toHaveClass(/copied/);
    });

    test('clicking expand toggle does not copy', async ({ page }) => {
      // Note: conversation_fixture.json is already loaded from beforeEach
      // Clear any existing clipboard
      await page.evaluate(() => navigator.clipboard.writeText(''));

      // Click the first expand toggle
      await page.locator('.expand-toggle').first().click();

      // Clipboard should still be empty (or at least not contain the bubble content)
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).not.toContain('help me understand recursion');
    });
  });

  test.describe('Sidebar Navigation', () => {
    test.beforeEach(async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles([
        path.join(FIXTURES_PATH, 'conversation_fixture.json'),
        path.join(FIXTURES_PATH, 'empty_turns_fixture.json')
      ]);
    });

    test('clicking sidebar item switches conversation', async ({ page }) => {
      // First conversation should be selected
      await expect(page.locator('#conv-title')).toHaveText('Test Conversation for Viewer');

      // Click second conversation
      await page.locator('#conv-list li').nth(1).click();
      await expect(page.locator('#conv-title')).toHaveText('Empty Conversation');
    });

    test('active item is highlighted', async ({ page }) => {
      await expect(page.locator('#conv-list li').first()).toHaveClass(/active/);

      await page.locator('#conv-list li').nth(1).click();
      await expect(page.locator('#conv-list li').nth(1)).toHaveClass(/active/);
      await expect(page.locator('#conv-list li').first()).not.toHaveClass(/active/);
    });
  });

  test.describe('Thinking Sections', () => {
    test.beforeEach(async ({ page }) => {
      const fileInput = page.locator('#file-input');
      await fileInput.setInputFiles(path.join(FIXTURES_PATH, 'conversation_fixture.json'));
    });

    test('shows thinking toggle for messages with thinking', async ({ page }) => {
      // Second message (index 1) has thinking
      const thinkingToggle = page.locator('.thinking-toggle');
      await expect(thinkingToggle).toHaveCount(1);
    });

    test('thinking content is hidden by default', async ({ page }) => {
      const thinkingContent = page.locator('.thinking-content');
      await expect(thinkingContent).not.toHaveClass(/visible/);
    });

    test('clicking thinking toggle shows thinking content', async ({ page }) => {
      await page.locator('.thinking-toggle').click();
      const thinkingContent = page.locator('.thinking-content');
      await expect(thinkingContent).toHaveClass(/visible/);
      await expect(thinkingContent).toContainText('explain recursion clearly');
    });
  });

  test.describe('Header Controls', () => {
    test('browse button triggers file input', async ({ page }) => {
      // We can't directly test the file dialog opening, but we can check the button exists
      await expect(page.locator('#browse-btn')).toBeVisible();
    });

    test('empty state browse button works', async ({ page }) => {
      await expect(page.locator('#empty-browse-btn')).toBeVisible();
    });
  });

  test.describe('Drag and Drop', () => {
    // Skip drag/drop overlay tests on Firefox due to DataTransfer limitations
    test('drag enter shows overlay', async ({ page, browserName }) => {
      test.skip(browserName === 'firefox', 'Firefox has DataTransfer limitations');

      const overlay = page.locator('#drop-overlay');
      await expect(overlay).not.toHaveClass(/active/);

      // Simulate dragenter event using page.evaluate
      await page.evaluate(() => {
        const event = new DragEvent('dragenter', {
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(event);
      });

      await expect(overlay).toHaveClass(/active/);
    });

    test('drag leave hides overlay', async ({ page, browserName }) => {
      test.skip(browserName === 'firefox', 'Firefox has DataTransfer limitations');

      const overlay = page.locator('#drop-overlay');

      // Enter drag mode
      await page.evaluate(() => {
        const event = new DragEvent('dragenter', {
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(event);
      });
      await expect(overlay).toHaveClass(/active/);

      // Leave drag mode
      await page.evaluate(() => {
        const event = new DragEvent('dragleave', {
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(event);
      });
      await expect(overlay).not.toHaveClass(/active/);
    });

    test('drop loads valid JSON file', async ({ page }) => {
      const fs = require('fs');

      // Read the fixture file content
      const fixtureContent = fs.readFileSync(
        path.join(FIXTURES_PATH, 'conversation_fixture.json'),
        'utf8'
      );

      // Create a drop event with file data
      await page.evaluate(async (content) => {
        // Create a mock File object
        const file = new File([content], 'test.json', { type: 'application/json' });

        // Create DataTransfer with the file
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Dispatch the drop event
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          dataTransfer: dataTransfer
        });
        document.dispatchEvent(dropEvent);
      }, fixtureContent);

      // Check that the conversation was loaded
      await expect(page.locator('#conv-list li')).toHaveCount(1);
      await expect(page.locator('#conv-count')).toHaveText('1');
      await expect(page.locator('#conv-title')).toHaveText('Test Conversation for Viewer');
    });

    test('drop hides overlay after file drop', async ({ page, browserName }) => {
      test.skip(browserName === 'firefox', 'Firefox has DataTransfer limitations');

      const overlay = page.locator('#drop-overlay');
      const fs = require('fs');

      const fixtureContent = fs.readFileSync(
        path.join(FIXTURES_PATH, 'conversation_fixture.json'),
        'utf8'
      );

      // Enter drag mode first
      await page.evaluate(() => {
        const event = new DragEvent('dragenter', {
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(event);
      });
      await expect(overlay).toHaveClass(/active/);

      // Drop the file
      await page.evaluate(async (content) => {
        const file = new File([content], 'test.json', { type: 'application/json' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          dataTransfer: dataTransfer
        });
        document.dispatchEvent(dropEvent);
      }, fixtureContent);

      // Overlay should be hidden after drop
      await expect(overlay).not.toHaveClass(/active/);
    });

    test('multi-file drop loads all files', async ({ page }) => {
      const fs = require('fs');

      const fixture1 = fs.readFileSync(
        path.join(FIXTURES_PATH, 'conversation_fixture.json'),
        'utf8'
      );
      const fixture2 = fs.readFileSync(
        path.join(FIXTURES_PATH, 'empty_turns_fixture.json'),
        'utf8'
      );

      // Drop multiple files
      await page.evaluate(async ({ content1, content2 }) => {
        const file1 = new File([content1], 'conv1.json', { type: 'application/json' });
        const file2 = new File([content2], 'conv2.json', { type: 'application/json' });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file1);
        dataTransfer.items.add(file2);

        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          dataTransfer: dataTransfer
        });
        document.dispatchEvent(dropEvent);
      }, { content1: fixture1, content2: fixture2 });

      // Both conversations should be loaded
      await expect(page.locator('#conv-list li')).toHaveCount(2);
      await expect(page.locator('#conv-count')).toHaveText('2');
    });
  });
});
