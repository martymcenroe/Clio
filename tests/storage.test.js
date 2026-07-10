/**
 * @jest-environment node
 */
// Storage / ledger tests (#48) — real IndexedDB behavior via fake-indexeddb.
// Runs in the Node environment (has structuredClone, which fake-indexeddb needs;
// jsdom does not). No DOM is required for storage.
require('fake-indexeddb/auto');
const { IDBFactory } = require('fake-indexeddb');
const db = require('../extensions/src/storage/db.js');

const K = { site: 'claude', account_label: 'personal', conversation_id: 'abc123' };
const K2 = { site: 'claude', account_label: 'personal', conversation_id: 'def456' };

beforeEach(() => {
  // Fresh, empty database for every test.
  globalThis.indexedDB = new IDBFactory();
  db._resetDbCache();
});

describe('schema', () => {
  test('openDb creates all five object stores', async () => {
    const conn = await db.openDb();
    expect(Array.from(conn.objectStoreNames).sort()).toEqual([
      'accounts', 'conversations', 'extraction_queue', 'harvest_runs', 'settings',
    ]);
  });
});

describe('conversations catalog + download ledger', () => {
  test('upsert then get round-trips, defaults to pending', async () => {
    await db.upsertConversation({ ...K, title: 'Hello', url: '/chat/abc123' });
    const got = await db.getConversation(K);
    expect(got.title).toBe('Hello');
    expect(got.url).toBe('/chat/abc123');
    expect(got.download_status).toBe('pending');
  });

  test('re-harvest updates metadata but PRESERVES download state (resume-safe)', async () => {
    await db.upsertConversation({ ...K, title: 'Hello' });
    await db.markDownloaded(K, { zip_name: 'abc.zip' });
    // A later metadata-only harvest must not undo the download.
    await db.upsertConversation({ ...K, title: 'Hello (renamed)' });
    const got = await db.getConversation(K);
    expect(got.title).toBe('Hello (renamed)');
    expect(got.download_status).toBe('done');
    expect(got.zip_name).toBe('abc.zip');
  });

  test('listConversations filters by download_status', async () => {
    await db.upsertConversation({ ...K, title: 'A' });
    await db.upsertConversation({ ...K2, title: 'B' });
    await db.markDownloaded(K, { zip_name: 'a.zip' });
    const done = await db.listConversations({ download_status: 'done' });
    const pending = await db.listConversations({ download_status: 'pending' });
    expect(done.map((c) => c.conversation_id)).toEqual(['abc123']);
    expect(pending.map((c) => c.conversation_id)).toEqual(['def456']);
  });

  test('statusCounts aggregates progress', async () => {
    await db.upsertConversation({ ...K, title: 'A' });
    await db.upsertConversation({ ...K2, title: 'B' });
    await db.markDownloaded(K, { zip_name: 'a.zip' });
    expect(await db.statusCounts()).toMatchObject({ total: 2, done: 1, pending: 1 });
  });

  test('markDownloadError flags conversation as error', async () => {
    await db.upsertConversation({ ...K, title: 'A' });
    await db.enqueueExtraction(K);
    await db.markDownloadError(K, 'boom');
    const conv = await db.getConversation(K);
    expect(conv.download_status).toBe('error');
    expect(conv.download_error).toBe('boom');
  });
});

describe('extraction / download queue', () => {
  test('enqueue then dequeue claims the row (in_progress)', async () => {
    await db.enqueueExtraction(K);
    const row = await db.dequeueNext();
    expect(row.conversation_id).toBe('abc123');
    expect(row.status).toBe('in_progress');
    expect(await db.dequeueNext()).toBeNull(); // nothing pending remains
  });

  test('enqueue is idempotent and never re-queues a done conversation', async () => {
    await db.upsertConversation({ ...K, title: 'A' });
    await db.enqueueExtraction(K);
    await db.markDownloaded(K, { zip_name: 'a.zip' }); // completes the queue row
    const again = await db.enqueueExtraction(K);
    expect(again.status).toBe('done'); // stays done, not reset to pending
  });
});

describe('harvest runs + settings', () => {
  test('recordRun returns an auto-assigned id', async () => {
    const id = await db.recordRun({ site: 'claude', account_label: 'personal', conversations_found: 223 });
    expect(id).toBeGreaterThan(0);
  });

  test('settings round-trip', async () => {
    await db.setSetting('rate_ms', 400);
    expect(await db.getSetting('rate_ms')).toBe(400);
    expect(await db.getSetting('missing')).toBeUndefined();
  });

  test('clearAll wipes every store (Start over)', async () => {
    await db.upsertConversation({ ...K, title: 'A' });
    await db.enqueueExtraction(K);
    await db.setSetting('x', 1);
    await db.clearAll();
    expect(await db.listConversations()).toEqual([]);
    expect(await db.dequeueNext()).toBeNull();
    expect(await db.getSetting('x')).toBeUndefined();
  });
});
