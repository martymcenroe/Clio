#!/usr/bin/env node
/**
 * Build script for Clio Viewer
 *
 * Combines viewer-logic.js (unit tested) with viewer.template.html
 * to produce the final viewer.html artifact.
 *
 * This ensures the production code contains the exact same logic
 * that was validated by unit tests.
 *
 * Usage: node viewer/build.js
 */

const fs = require('fs');
const path = require('path');

const VIEWER_DIR = __dirname;
const LOGIC_FILE = path.join(VIEWER_DIR, 'viewer-logic.js');
const TEMPLATE_FILE = path.join(VIEWER_DIR, 'viewer.template.html');
const OUTPUT_FILE = path.join(VIEWER_DIR, 'viewer.html');

// Marker in template where logic will be injected
const LOGIC_PLACEHOLDER = '// {{VIEWER_LOGIC}}';

function build() {
  console.log('Building viewer.html...');

  // Read source files
  const logicContent = fs.readFileSync(LOGIC_FILE, 'utf8');
  const templateContent = fs.readFileSync(TEMPLATE_FILE, 'utf8');

  // Extract just the function definitions from viewer-logic.js
  // Remove the module.exports block since it's not needed in browser
  const logicForBrowser = logicContent
    .replace(/\/\*\*[\s\S]*?\*\/\n/g, '') // Remove JSDoc comments
    .replace(/module\.exports\s*=\s*\{[\s\S]*?\};?\s*$/, '') // Remove exports
    .trim();

  // Inject logic into template
  if (!templateContent.includes(LOGIC_PLACEHOLDER)) {
    console.error(`Error: Template missing placeholder "${LOGIC_PLACEHOLDER}"`);
    process.exit(1);
  }

  const output = templateContent.replace(LOGIC_PLACEHOLDER, logicForBrowser);

  // Write output
  fs.writeFileSync(OUTPUT_FILE, output, 'utf8');

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`  - Logic from: ${LOGIC_FILE}`);
  console.log(`  - Template from: ${TEMPLATE_FILE}`);
}

// Run build
build();
