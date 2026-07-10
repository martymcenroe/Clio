/* global indexedDB */
// Clio 2.0 — local archive store (#48).
//
// IndexedDB-backed persistence for the batch-download feature: the catalog of
// conversations, the extraction/download queue, harvest-run records, per-account
// labels, and settings. This is the "database of what you downloaded" — it lets
// the batch walk resume, skip already-downloaded conversations, and report
// progress.
//
// Promise-based API; works in the extension (real `indexedDB`) and under Jest
// (fake-indexeddb). No third-party runtime deps.

const DB_NAME = 'clio-archive';
const DB_VERSION = 1;

// Object stores and their key configuration.
const STORES = {
  accounts: { keyPath: 'account_label' },
  conversations: { keyPath: ['site', 'account_label', 'conversation_id'] },
  harvest_runs: { keyPath: 'run_id', autoIncrement: true },
  extraction_queue: { keyPath: 'conversation_key' },
  settings: { keyPath: 'key' },
};

let _dbPromise = null;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Open (and migrate) the database. Cached after first call. */
function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const [name, opts] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, opts);
        if (name === 'conversations') {
          store.createIndex('by_download_status', 'download_status', { unique: false });
        }
        if (name === 'extraction_queue') {
          store.createIndex('by_status', 'status', { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

/** Reset the cached connection (tests / re-init). */
function _resetDbCache() {
  _dbPromise = null;
}

/** Wrap an IDBRequest as a Promise. */
function _await(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run `fn(store)` inside a transaction and resolve when it commits. */
async function _withStore(name, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const store = transaction.objectStore(name);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const _put = (name, value) => _withStore(name, 'readwrite', (s) => _await(s.put(value)));
const _get = (name, key) => _withStore(name, 'readonly', (s) => _await(s.get(key)));
const _getAll = (name) => _withStore(name, 'readonly', (s) => _await(s.getAll()));

// Composite conversation key <-> flat string key (used by extraction_queue).
const convKey = ({ site, account_label, conversation_id }) => [site, account_label, conversation_id];
const flatKey = ({ site, account_label, conversation_id }) => `${site}::${account_label}::${conversation_id}`;

// ---------------------------------------------------------------------------
// Accounts (#48 / F3)
// ---------------------------------------------------------------------------

const upsertAccount = ({ account_label, site }) =>
  _put('accounts', { account_label, site, created_at: new Date().toISOString() });
const listAccounts = () => _getAll('accounts');

// ---------------------------------------------------------------------------
// Conversations catalog + download ledger
// ---------------------------------------------------------------------------

/** Insert or update a conversation row. Preserves download state on re-harvest. */
async function upsertConversation(row) {
  const existing = await _get('conversations', convKey(row));
  const merged = {
    site: row.site,
    account_label: row.account_label,
    conversation_id: row.conversation_id,
    title: row.title ?? existing?.title ?? '',
    url: row.url ?? existing?.url ?? null,
    list_position: row.list_position ?? existing?.list_position ?? null,
    updated_at: row.updated_at ?? existing?.updated_at ?? null,
    harvested_at: new Date().toISOString(),
    // Download-ledger fields (never clobbered by a metadata re-harvest):
    download_status: existing?.download_status ?? 'pending',
    downloaded_at: existing?.downloaded_at ?? null,
    zip_name: existing?.zip_name ?? null,
    download_error: existing?.download_error ?? null,
  };
  await _put('conversations', merged);
  return merged;
}

const getConversation = (keyObj) => _get('conversations', convKey(keyObj));

/** List conversations, optionally filtered by site / account_label / download_status. */
async function listConversations(filter = {}) {
  const all = await _getAll('conversations');
  return all.filter((c) =>
    (filter.site === undefined || c.site === filter.site) &&
    (filter.account_label === undefined || c.account_label === filter.account_label) &&
    (filter.download_status === undefined || c.download_status === filter.download_status));
}

/** Mark a conversation downloaded (ledger success) and complete its queue row. */
async function markDownloaded(keyObj, { zip_name } = {}) {
  const conv = await _get('conversations', convKey(keyObj));
  if (conv) {
    conv.download_status = 'done';
    conv.downloaded_at = new Date().toISOString();
    conv.zip_name = zip_name ?? conv.zip_name;
    conv.download_error = null;
    await _put('conversations', conv);
  }
  await _setQueueStatus(keyObj, 'done');
}

/** Mark a conversation's download failed (ledger error) and flag its queue row. */
async function markDownloadError(keyObj, error) {
  const conv = await _get('conversations', convKey(keyObj));
  if (conv) {
    conv.download_status = 'error';
    conv.download_error = String(error).slice(0, 500);
    await _put('conversations', conv);
  }
  const q = await _get('extraction_queue', flatKey(keyObj));
  await _put('extraction_queue', {
    conversation_key: flatKey(keyObj),
    ...keyObj,
    status: 'error',
    attempts: (q?.attempts ?? 0) + 1,
    last_error: String(error).slice(0, 500),
    enqueued_at: q?.enqueued_at ?? new Date().toISOString(),
  });
}

/** Aggregate download progress counts (for the #63 progress UI). */
async function statusCounts(filter = {}) {
  const rows = await listConversations(filter);
  return rows.reduce((acc, c) => {
    acc.total += 1;
    acc[c.download_status] = (acc[c.download_status] || 0) + 1;
    return acc;
  }, { total: 0, pending: 0, done: 0, error: 0 });
}

// ---------------------------------------------------------------------------
// Extraction / download queue (#60 worker consumes this)
// ---------------------------------------------------------------------------

/** Enqueue a conversation for extraction (idempotent; skips already-done rows). */
async function enqueueExtraction(keyObj) {
  const key = flatKey(keyObj);
  const existing = await _get('extraction_queue', key);
  if (existing && existing.status === 'done') return existing;
  const row = {
    conversation_key: key,
    site: keyObj.site,
    account_label: keyObj.account_label,
    conversation_id: keyObj.conversation_id,
    status: 'pending',
    attempts: existing?.attempts ?? 0,
    last_error: null,
    enqueued_at: existing?.enqueued_at ?? new Date().toISOString(),
  };
  await _put('extraction_queue', row);
  return row;
}

async function _setQueueStatus(keyObj, status) {
  const key = flatKey(keyObj);
  const row = await _get('extraction_queue', key);
  if (!row) return;
  row.status = status;
  await _put('extraction_queue', row);
}

/** Claim the next pending queue row (marks it in_progress) or null if none. */
async function dequeueNext() {
  const all = await _getAll('extraction_queue');
  const next = all.find((r) => r.status === 'pending');
  if (!next) return null;
  next.status = 'in_progress';
  await _put('extraction_queue', next);
  return next;
}

// ---------------------------------------------------------------------------
// Harvest runs + settings
// ---------------------------------------------------------------------------

/** Record a harvest run; returns the auto-assigned run_id. */
const recordRun = (run) =>
  _withStore('harvest_runs', 'readwrite', (s) => _await(s.add({ ...run, recorded_at: new Date().toISOString() })));

const getSetting = async (key) => (await _get('settings', key))?.value;
const setSetting = (key, value) => _put('settings', { key, value });

/** Wipe all data (fresh start / "re-download everything"). */
async function clearAll() {
  const db = await openDb();
  const names = Array.from(db.objectStoreNames);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, 'readwrite');
    for (const name of names) transaction.objectStore(name).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DB_NAME, DB_VERSION, STORES,
    openDb, _resetDbCache, convKey, flatKey,
    upsertAccount, listAccounts,
    upsertConversation, getConversation, listConversations,
    markDownloaded, markDownloadError, statusCounts,
    enqueueExtraction, dequeueNext,
    recordRun, getSetting, setSetting, clearAll,
  };
}
