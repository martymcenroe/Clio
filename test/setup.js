// Jest setup file for Clio tests

// Mock chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    },
    onInstalled: {
      addListener: jest.fn()
    },
    lastError: null
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn()
  },
  downloads: {
    download: jest.fn(),
    onChanged: {
      addListener: jest.fn()
    }
  }
};

// Reset chrome mocks before each test
beforeEach(() => {
  chrome.runtime.sendMessage.mockClear();
  chrome.runtime.onMessage.addListener.mockClear();
  chrome.runtime.onInstalled.addListener.mockClear();
  chrome.runtime.lastError = null;
  chrome.tabs.query.mockClear();
  chrome.tabs.sendMessage.mockClear();
  chrome.downloads.download.mockClear();
  chrome.downloads.onChanged.addListener.mockClear();
});

// Mock JSZip for popup.js tests
class MockJSZip {
  constructor() {
    this.files = {};
    this.folders = {};
  }

  file(name, content, options) {
    this.files[name] = { content, options };
    return this;
  }

  folder(name) {
    if (!this.folders[name]) {
      this.folders[name] = new MockJSZip();
    }
    return this.folders[name];
  }

  async generateAsync(options) {
    return new Blob(['mock-zip-content'], { type: 'application/zip' });
  }
}

global.JSZip = MockJSZip;

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// Helper to load fixture HTML
global.loadFixture = (name) => {
  const fs = require('fs');
  const path = require('path');
  const fixturePath = path.join(__dirname, 'fixtures', name);
  return fs.readFileSync(fixturePath, 'utf8');
};

// Helper to set document body from fixture
global.setFixture = (name) => {
  document.body.innerHTML = loadFixture(name);
};
