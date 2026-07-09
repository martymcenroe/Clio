/**
 * @jest-environment node
 */
// Batch worker tests (#60) — the walk loop over the real ledger, with the
// browser glue (navigate/extract/zip/download) injected as mocks.
require('fake-indexeddb/auto');
const { IDBFactory } = require('fake-indexeddb');
const db = require('../extensions/src/storage/db.js');

// archive.js references the db API and sleep as bare globals (loaded as sibling
// <script>s in the extension). Expose them for the node test.
Object.assign(global, {
  getConversation: db.getConversation,
  upsertConversation: db.upsertConversation,
  enqueueExtraction: db.enqueueExtraction,
  markDownloaded: db.markDownloaded,
  markDownloadError: db.markDownloadError,
  dequeueNext: db.dequeueNext,
  statusCounts: db.statusCounts,
  sleepImpl: () => Promise.resolve(), // no real delays in tests
});
const archive = require('../extensions/src/archive.js');

const C1 = { site: 'claude', account_label: 'personal', conversation_id: 'aaa', title: 'One', url: 'https://claude.ai/chat/aaa' };
const C2 = { site: 'claude', account_label: 'personal', conversation_id: 'bbb', title: 'Two', url: 'https://claude.ai/chat/bbb' };

function okDeps() {
  return {
    navigateAndExtract: jest.fn(async () => ({ success: true, data: { metadata: { title: 'T' }, messages: [] }, images: [] })),
    buildZip: jest.fn(async () => 'BLOB'),
    downloadZip: jest.fn(async () => 7),
  };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  db._resetDbCache();
  await db.upsertConversation(C1);
  await db.upsertConversation(C2);
  await db.enqueueExtraction(C1);
  await db.enqueueExtraction(C2);
});

describe('zipName / sanitize', () => {
  test('composes a current-design filename under clio-archive/', () => {
    expect(archive.zipName(C1, { metadata: { title: 'One' } })).toBe('clio-archive/claude-One-aaa.zip');
  });
  test('sanitizes unsafe title chars', () => {
    expect(archive.sanitize('Can\'t Stop: the math!')).toBe('Can_t_Stop_the_math');
  });
});

describe('processOne', () => {
  test('success path downloads and marks the ledger done', async () => {
    const deps = okDeps();
    const r = await archive.processOne(1, C1, deps);
    expect(r).toMatchObject({ ok: true, filename: 'clio-archive/claude-One-aaa.zip' });
    expect(r).toHaveProperty('messageCount'); // diagnostics recorded for the run report
    expect(deps.navigateAndExtract).toHaveBeenCalledWith(1, C1.url, 'claude');
    expect(deps.downloadZip).toHaveBeenCalledWith('BLOB', 'clio-archive/claude-One-aaa.zip');
    const conv = await db.getConversation(C1);
    expect(conv.download_status).toBe('done');
    expect(conv.zip_name).toBe('clio-archive/claude-One-aaa.zip');
  });

  test('failure path records an error in the ledger (fail-open, keeps walking)', async () => {
    const deps = okDeps();
    deps.navigateAndExtract = jest.fn(async () => { throw new Error('render timeout'); });
    const r = await archive.processOne(1, C1, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('render timeout');
    const conv = await db.getConversation(C1);
    expect(conv.download_status).toBe('error');
    expect(conv.download_error).toBe('render timeout');
  });
});

describe('seedQueue', () => {
  test('upserts conversations and enqueues them, then the worker drains them', async () => {
    // fresh DB with nothing seeded (override the beforeEach seeding)
    globalThis.indexedDB = new (require('fake-indexeddb').IDBFactory)();
    db._resetDbCache();
    const convs = [
      { conversation_id: 'x1', url: 'https://claude.ai/chat/x1', title: 'X1' },
      { conversation_id: 'x2', url: 'https://claude.ai/chat/x2', title: 'X2' },
    ];
    const res = await archive.seedQueue(convs, 'claude', 'personal');
    expect(res).toEqual({ enumerated: 2, queued: 2 });
    expect(await db.statusCounts()).toMatchObject({ total: 2, pending: 2 });

    const walk = await archive.runBatch(
      { tabId: 1, paceMs: 0, isPaused: () => false, isCancelled: () => false }, okDeps());
    expect(walk).toEqual({ done: 2, failed: 0 });
  });
});

describe('runBatch', () => {
  test('drains the queue, marks all done, reports progress', async () => {
    const deps = okDeps();
    const onProgress = jest.fn();
    const res = await archive.runBatch(
      { tabId: 1, paceMs: 0, isPaused: () => false, isCancelled: () => false, onProgress }, deps);
    expect(res).toEqual({ done: 2, failed: 0 });
    expect(deps.navigateAndExtract).toHaveBeenCalledTimes(2);
    expect(await db.statusCounts()).toMatchObject({ total: 2, done: 2, pending: 0 });
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  test('cancel stops the walk immediately', async () => {
    const deps = okDeps();
    const res = await archive.runBatch(
      { tabId: 1, paceMs: 0, isPaused: () => false, isCancelled: () => true }, deps);
    expect(res).toEqual({ done: 0, failed: 0 });
    expect(deps.navigateAndExtract).not.toHaveBeenCalled();
  });

  test('resume-safe: a second run only processes what is still pending', async () => {
    const deps = okDeps();
    await archive.runBatch({ tabId: 1, paceMs: 0, isPaused: () => false, isCancelled: () => false }, deps);
    // Re-enqueue is idempotent for done rows; a fresh run should find nothing.
    await db.enqueueExtraction(C1);
    await db.enqueueExtraction(C2);
    const deps2 = okDeps();
    const res = await archive.runBatch({ tabId: 1, paceMs: 0, isPaused: () => false, isCancelled: () => false }, deps2);
    expect(res).toEqual({ done: 0, failed: 0 });
    expect(deps2.navigateAndExtract).not.toHaveBeenCalled();
  });
});
