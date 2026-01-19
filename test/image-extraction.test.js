/**
 * Tests for image extraction and Fail Open logic.
 *
 * LLD Reference: docs/reports/1/lld-clio.md
 * Covers: Scenarios 065, 100, 105 (Fail Open for images)
 */

const {
  extractImages,
  extractConversation
} = require('../extension/src/content.js');

const { SELECTORS } = require('../extension/src/selectors.js');

global.SELECTORS = SELECTORS;

// Mock fetch for testing different scenarios
const originalFetch = global.fetch;

describe('Image Extraction - Fail Open Logic', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Reset fetch mock
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // Test ID: IMG-010 - LLD Scenario 065
  describe('fetchImage handles different URL schemes', () => {
    test('handles data: URLs correctly', async () => {
      const turns = [{
        index: 0,
        role: 'user',
        content: 'test',
        attachments: [{
          type: 'image',
          originalSrc: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        }]
      }];

      const { images, errors } = await extractImages(turns);

      expect(images.length).toBe(1);
      expect(errors.length).toBe(0);
      expect(images[0].filename).toMatch(/images\/\d{3}\.png/);
      expect(images[0].blob).toBeInstanceOf(Blob);
    });

    test('handles invalid data: URL format', async () => {
      const turns = [{
        index: 0,
        role: 'user',
        content: 'test',
        attachments: [{
          type: 'image',
          originalSrc: 'data:invalid-format'
        }]
      }];

      const { images, errors } = await extractImages(turns);

      // Fail Open: error logged but extraction continues
      expect(images.length).toBe(0);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('Invalid data URL');
    });

    test('handles https: URLs with successful fetch', async () => {
      // Mock successful fetch
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'], { type: 'image/jpeg' }))
      });

      const turns = [{
        index: 0,
        role: 'user',
        content: 'test',
        attachments: [{
          type: 'image',
          originalSrc: 'https://example.com/image.jpg'
        }]
      }];

      const { images, errors } = await extractImages(turns);

      expect(images.length).toBe(1);
      expect(errors.length).toBe(0);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/image.jpg',
        expect.objectContaining({ credentials: 'include' })
      );
    });

    test('handles https: URL fetch failure (HTTP error)', async () => {
      // Mock failed fetch (404)
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const turns = [{
        index: 0,
        role: 'user',
        content: 'test',
        attachments: [{
          type: 'image',
          originalSrc: 'https://example.com/missing.jpg'
        }]
      }];

      const { images, errors } = await extractImages(turns);

      // Fail Open: error logged, extraction continues
      expect(images.length).toBe(0);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('404');
    });

    test('handles network failure (CORS, timeout, etc.)', async () => {
      // Mock network error
      global.fetch = jest.fn().mockRejectedValue(new Error('CORS error'));

      const turns = [{
        index: 0,
        role: 'user',
        content: 'test',
        attachments: [{
          type: 'image',
          originalSrc: 'https://blocked.example.com/image.jpg'
        }]
      }];

      const { images, errors } = await extractImages(turns);

      // Fail Open: error logged, extraction continues
      expect(images.length).toBe(0);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('CORS');
    });
  });

  // Test ID: IMG-020 - LLD Scenario 100, 105
  describe('Fail Open behavior', () => {
    test('continues extraction when some images fail', async () => {
      // First image succeeds, second fails
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          blob: () => Promise.resolve(new Blob(['test'], { type: 'image/png' }))
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const turns = [{
        index: 0,
        role: 'user',
        content: 'first message',
        attachments: [{
          type: 'image',
          originalSrc: 'https://example.com/good.png'
        }]
      }, {
        index: 1,
        role: 'assistant',
        content: 'response',
        attachments: [{
          type: 'image',
          originalSrc: 'https://example.com/bad.png'
        }]
      }];

      const { images, errors } = await extractImages(turns);

      // Fail Open: one image succeeded, one failed, both recorded
      expect(images.length).toBe(1);
      expect(errors.length).toBe(1);
      expect(images[0].filename).toBe('images/001.png');
    });

    test('records error metadata for failed images', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Timeout'));

      const turns = [{
        index: 5,
        role: 'user',
        content: 'test',
        attachments: [{
          type: 'image',
          originalSrc: 'https://slow.example.com/image.jpg'
        }]
      }];

      const { errors } = await extractImages(turns);

      expect(errors.length).toBe(1);
      expect(errors[0]).toMatchObject({
        type: 'image_fetch',
        turnIndex: 5,
        originalSrc: 'https://slow.example.com/image.jpg'
      });
      expect(errors[0].timestamp).toBeDefined();
      expect(errors[0].message).toContain('Timeout');
    });

    test('all images fail but JSON still generated', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('All blocked'));

      const turns = [{
        index: 0,
        role: 'user',
        content: 'message with images',
        attachments: [
          { type: 'image', originalSrc: 'https://a.com/1.jpg' },
          { type: 'image', originalSrc: 'https://b.com/2.jpg' },
          { type: 'image', originalSrc: 'https://c.com/3.jpg' }
        ]
      }];

      const { images, errors } = await extractImages(turns);

      // Fail Open: all failed, but we got error records for all
      expect(images.length).toBe(0);
      expect(errors.length).toBe(3);
    });
  });

  // Test ID: IMG-030 - Image extension detection
  describe('getImageExtension', () => {
    test('extracts extension from MIME type', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'], { type: 'image/jpeg' }))
      });

      const turns = [{
        index: 0,
        role: 'user',
        content: 'test',
        attachments: [{ type: 'image', originalSrc: 'https://example.com/photo' }]
      }];

      const { images } = await extractImages(turns);

      expect(images[0].filename).toMatch(/\.jpg$/);
    });

    test('extracts extension from URL when MIME unavailable', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'], { type: '' }))
      });

      const turns = [{
        index: 0,
        role: 'user',
        content: 'test',
        attachments: [{ type: 'image', originalSrc: 'https://example.com/photo.webp' }]
      }];

      const { images } = await extractImages(turns);

      expect(images[0].filename).toMatch(/\.webp$/);
    });

    test('defaults to png when extension unknown', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'], { type: '' }))
      });

      const turns = [{
        index: 0,
        role: 'user',
        content: 'test',
        attachments: [{ type: 'image', originalSrc: 'https://example.com/blob-url-no-ext' }]
      }];

      const { images } = await extractImages(turns);

      expect(images[0].filename).toMatch(/\.png$/);
    });
  });

  // Test ID: IMG-040 - Batch processing of images
  describe('extractImages batch processing', () => {
    test('processes images in batches of 10', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'], { type: 'image/png' }))
      });
      global.fetch = fetchMock;

      // Create 25 images across multiple turns
      const turns = [];
      for (let i = 0; i < 25; i++) {
        turns.push({
          index: i,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `message ${i}`,
          attachments: [{ type: 'image', originalSrc: `https://example.com/img${i}.png` }]
        });
      }

      const { images, errors } = await extractImages(turns);

      expect(images.length).toBe(25);
      expect(errors.length).toBe(0);
      // All 25 fetch calls made
      expect(fetchMock).toHaveBeenCalledTimes(25);
    });
  });
});

describe('extractConversation with image errors', () => {
  beforeEach(() => {
    // Use fast scroll config for tests
    const { setScrollConfig } = require('../extension/src/content.js');
    setScrollConfig({
      scrollStep: 100,
      scrollDelay: 10,
      mutationTimeout: 50,
      maxScrollAttempts: 20,
      loadingCheckInterval: 10,
      maxLoadingWait: 100,
      progressUpdateInterval: 2
    });

    // Create a fixture with https images that will be fetched
    document.body.innerHTML = `
      <main data-conversation-id="error-test">
        <h1 data-conversation-title>Test with Failing Images</h1>
        <div class="conversation-turn" data-message-author-role="user">
          <div class="user-query-container">
            Message with https image:
            <img src="https://example.com/will-fail.png">
          </div>
        </div>
        <div class="conversation-turn" data-message-author-role="model">
          <div class="response-container">Response</div>
        </div>
      </main>
    `;
  });

  afterEach(() => {
    const { resetScrollConfig } = require('../extension/src/content.js');
    resetScrollConfig();
  });

  test('reports partialSuccess when https images fail', async () => {
    // Mock fetch to fail for https images
    global.fetch = jest.fn().mockRejectedValue(new Error('Blocked'));

    const result = await extractConversation();

    expect(result.success).toBe(true);
    expect(result.data.metadata.partialSuccess).toBe(true);
    expect(result.data.metadata.extractionErrors.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('includes extraction errors in metadata for https failures', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

    const result = await extractConversation();

    expect(result.success).toBe(true);
    expect(result.data.metadata.extractionErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image_fetch',
          message: expect.stringContaining('Network failure')
        })
      ])
    );
  });
});
