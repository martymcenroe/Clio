// Jest setup file for Clio tests

// Mock chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    }
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn()
  },
  downloads: {
    download: jest.fn()
  }
};

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
