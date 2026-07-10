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

// Per-run subfolder so this run's files can't collide with an earlier run's.
const RUN = 'run-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
setRunTag(RUN);

const control = { paused: false, cancelled: false };

// Self-instrumentation: a machine-readable record of the whole run, downloaded at
// the end so the result can be verified against ground truth without any relay.
const runReport = {
  site: SITE, account: ACCOUNT, startedAt: null, finishedAt: null,
  enumerated: null, results: [], summary: null,
};

function downloadReport() {
  const blob = new Blob([JSON.stringify(runReport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download(
    { url, filename: `clio-archive/${RUN}/clio-run-report-${SITE}.json`, saveAs: false },
    () => setTimeout(() => URL.revokeObjectURL(url), 2000),
  );
}

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
  // The worker tab must be ACTIVE: a background tab doesn't trigger Claude's
  // lazy-load of older messages, so scrollToLoadAllMessages only sees the last
  // ~10 turns and long conversations get truncated (#204). Keep it foreground.
  const tab = await chrome.tabs.create({ url: SITE_BASE, active: true });
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

  // Inject the enumerator and get the COMPLETE conversation list inside the tab.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/enumerate.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (site) => window.enumerateFull(site),
    args: [SITE],
  });
  return result || [];
}

async function main() {
  $('site').textContent = `Site: ${SITE} · account: ${ACCOUNT} · saving to Downloads/clio-archive/${RUN}/`;
  $('pauseBtn').onclick = () => {
    control.paused = !control.paused;
    $('pauseBtn').textContent = control.paused ? 'Resume' : 'Pause';
    setPhase(control.paused ? 'Paused' : 'Walking & downloading…');
  };
  $('cancelBtn').onclick = () => { control.cancelled = true; setPhase('Cancelling…'); };
  $('resetBtn').onclick = async () => {
    if (!confirm('Clear saved progress and re-download EVERY conversation from scratch? Use this after an update so the fixes apply to all conversations.')) return;
    control.cancelled = true;
    await clearAll();
    location.reload();
  };

  await openDb();

  setPhase('Opening a worker tab…');
  const tabId = await ensureWorkerTab();

  setPhase('Getting your full conversation list…');
  const convs = await enumerateInTab(tabId);
  runReport.startedAt = new Date().toISOString();
  runReport.enumerated = {
    count: convs.length,
    conversations: convs.map((c) => ({ id: c.conversation_id, title: c.title, url: c.url })),
  };
  log(`Enumerated ${convs.length} conversations.`);
  if (!convs.length) {
    setPhase('No conversations found — make sure you are logged in and the sidebar is visible, then reload.');
    runReport.summary = { done: 0, failed: 0, note: 'enumeration found nothing' };
    downloadReport();
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
    onProgress: (counts, last) => {
      render(counts, last);
      if (last && last.conv) {
        runReport.results.push({
          id: last.conv.conversation_id,
          title: last.conv.title,
          status: last.result.ok ? 'done' : 'error',
          filename: last.result.filename || null,
          messageCount: last.result.messageCount,
          imageCount: last.result.imageCount,
          textLength: last.result.textLength,
          error: last.result.error || null,
        });
      }
    },
  });

  render(await statusCounts({ site: SITE, account_label: ACCOUNT }));
  runReport.finishedAt = new Date().toISOString();
  runReport.summary = { done: res.done, failed: res.failed, cancelled: control.cancelled };
  downloadReport();
  setPhase(control.cancelled
    ? `Cancelled — ${res.done} downloaded, ${res.failed} failed. Run report saved to clio-archive/.`
    : `Done — ${res.done} downloaded, ${res.failed} failed. Run report saved to clio-archive/.`);
  log(`FINISHED: ${res.done} downloaded, ${res.failed} failed. Report + ZIPs in Downloads/clio-archive/.`);
  $('pauseBtn').disabled = true;
}

main().catch((e) => {
  setPhase('Error: ' + (e.message || e));
  log('FATAL ' + (e.message || e), 'xx');
});
