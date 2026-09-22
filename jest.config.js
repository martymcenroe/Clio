module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  // Playwright tests named *.e2e.test.js match testMatch above but import
  // @playwright/test and cannot run under jest. playwright.config.js claims
  // them via testMatch: ['**/*.e2e.test.js', '**/*.spec.js'].
  //
  // Anchored to the suffix on purpose (#371). This lived in the npm scripts as
  // `--testPathIgnorePatterns=e2e`, a bare substring matched against the whole
  // path, which silently dropped any test with `e2e` anywhere in its name --
  // found when tests/e2e-write-targets.test.js was collected by jest and then
  // excluded by `npm test`, with no warning and a green suite.
  //
  // Keeping it here rather than in the scripts also means a bare `npx jest`
  // collects exactly what `npm test` collects.
  testPathIgnorePatterns: ['/node_modules/', '\\.e2e\\.test\\.js$'],
  collectCoverageFrom: [
    'extensions/src/**/*.js'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};
