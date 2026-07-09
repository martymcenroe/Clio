/* global chrome, openDb, statusCounts, seedQueue, runBatch */
// Clio 2.0 — Download-All page orchestrator (#63 + wiring).
//
// Opens one background "worker tab" on the site, enumerates the full conversation
// list in it (scroll-until-stable, via enumerate.js injected with chrome.scripting),
// seeds the ledger queue, then runs the batch worker (archive.js) which drives the
// same tab through each conversation. Live progress + pause / resume / cancel.

const params = new URLSearchParams(location.search);
const SITE = params.get('site') || 'claude';
const ACCOUNT = params.get('account') || 'default';
const SITE_BASE = {
  claude: 'https://claude.ai/',
  gemini: 'https://gemini.google.com/app',
  chatgpt: 'https://chatgpt.com/',
}[SITE] || 'https://claude.ai/';

const control = { paused: false, cancelled: false };
const $ = (id) => document.getElementById(id);
const setPhase = (t) => { $('phase').textContent = t; };

function log(msg, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  $('log').insertBefore(line, $('log').firstChild);
}

function render(counts, last) {
  const total = counts.total || 0;
  $('bar').max = total || 1;
  $('bar').value = (counts.done || 0) + (counts.error || 0);
  $('counts').innerHTML =
    `<b>${counts.done || 0}</b> downloaded · <b>${counts.error || 0}</b> failed · <b>${counts.pending || 0}</b> left (of ${total})`;
  if (last && last.conv) {
    const t = last.conv.title || last.conv.conversation_id;
    $('current').textContent = `Last: ${t}`;
    log(`${last.result.ok ? 'OK ' : 'XX '} ${t}`, last.result.ok ? 'ok' : 'xx');
  }
}

function tabComplete(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureWorkerTab() {
  const tab = await chrome.tabs.create({ url: SITE_BASE, active: false }); // background; user watches this page
  await tabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 3000)); // let the app hydrate
  return tab.id;
}

async function enumerateInTab(tabId) {
  // Best-effort: open + pin the sidebar so the full list is present + scrollable (Claude).
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      for (const sel of ['button[aria-label="Open sidebar"]', '[data-testid="pin-sidebar-toggle"]']) {
        const el = document.querySelector(sel);
        if (el) el.click();
      }
    },
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  // Inject the enumerator and run scroll-until-stable inside the tab.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/enumerate.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (site) => window.enumerateAll(site),
    args: [SITE],
  });
  return result || [];
}

async function main() {
  $('site').textContent = `Site: ${SITE} · account: ${ACCOUNT}`;
  $('pauseBtn').onclick = () => {
    control.paused = !control.paused;
    $('pauseBtn').textContent = control.paused ? 'Resume' : 'Pause';
    setPhase(control.paused ? 'Paused' : 'Walking & downloading…');
  };
  $('cancelBtn').onclick = () => { control.cancelled = true; setPhase('Cancelling…'); };

  await openDb();

  setPhase('Opening a worker tab…');
  const tabId = await ensureWorkerTab();

  setPhase('Enumerating conversations (scrolling the list)…');
  const convs = await enumerateInTab(tabId);
  log(`Enumerated ${convs.length} conversations.`);
  if (!convs.length) {
    setPhase('No conversations found — make sure you are logged in and the sidebar is visible, then reload.');
    return;
  }

  await seedQueue(convs, SITE, ACCOUNT);
  render(await statusCounts({ site: SITE, account_label: ACCOUNT }));

  setPhase('Walking & downloading…');
  const res = await runBatch({
    tabId,
    paceMs: 800,
    isPaused: () => control.paused,
    isCancelled: () => control.cancelled,
    onProgress: (counts, last) => render(counts, last),
  });

  render(await statusCounts({ site: SITE, account_label: ACCOUNT }));
  setPhase(control.cancelled
    ? `Cancelled — ${res.done} downloaded, ${res.failed} failed.`
    : `Done — ${res.done} downloaded, ${res.failed} failed.`);
  log(`FINISHED: ${res.done} downloaded, ${res.failed} failed.`);
  $('pauseBtn').disabled = true;
}

main().catch((e) => {
  setPhase('Error: ' + (e.message || e));
  log('FATAL ' + (e.message || e), 'xx');
});
