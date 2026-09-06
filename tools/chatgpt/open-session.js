// Open the browser window every other script in this directory attaches to.
//
//   CLIO_URL=https://chatgpt.com/c/<id> node tools/chatgpt/open-session.js
//
// Every probe here says "attaches to the window already open on 9333", and
// nothing in the repo opened it — so each live session began with the operator
// assembling a Chrome command line by hand. This is that command line.
//
// It spawns Chrome DETACHED rather than through launchPersistentContext.
// Playwright owns the browser it launches and kills it when the driver process
// exits, so a launcher built that way opens a window and takes it away again
// the moment the script returns: the next probe finds nothing on the port and
// silently opens a second window. Detached, the window outlives every probe
// run, which is the whole point of reattaching over CDP.
//
// Never closes a browser. The operator owns that window, and tearing it down
// costs a login.

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const PROFILE = process.env.CLIO_PROFILE ||
  path.join(os.homedir(), '.clio-profiles', 'chatgpt');
const URL = process.env.CLIO_URL || 'https://chatgpt.com/';

const CHROME_CANDIDATES = [
  process.env.CLIO_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].filter(Boolean);

const say = (s) => process.stdout.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Whatever is serving CDP on the port, or null. */
function cdpVersion() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/json/version`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(1500, () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  const already = await cdpVersion();
  if (already) {
    // Real Chrome, already there. Opening a second window on the same profile
    // would fail on the profile lock anyway.
    say(`already serving CDP on ${PORT}: ${already.Browser}`);
    say('leaving it alone; run the probes against it');
    return;
  }

  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) {
    say(`no Chrome found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
    say('set CLIO_CHROME to the executable.');
    process.exitCode = 1;
    return;
  }

  say(`chrome:  ${chrome}`);
  say(`profile: ${PROFILE}`);
  say(`port:    ${PORT}`);

  // Real Chrome rather than Playwright's bundled chromium: the profile was
  // written by real Chrome, and the bundled build refuses a newer profile,
  // aborting right after printing "DevTools listening" — which reads exactly
  // like a profile lock and is not (README).
  const child = spawn(chrome, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    URL
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const v = await cdpVersion();
    if (v) {
      say(`up: ${v.Browser}`);
      say(`opened ${URL}`);
      say(`probes attach with connectOverCDP('http://127.0.0.1:${PORT}')`);
      return;
    }
  }
  say(`Chrome did not answer CDP on ${PORT} within 20s.`);
  process.exitCode = 1;
}

main().catch((e) => { say(`FAILED: ${e.message}`); process.exitCode = 1; });
