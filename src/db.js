/**
 * Minimal promise wrapper around IndexedDB.
 * Stores:
 *  - 'fonts':   fontId -> ArrayBuffer (persisted webfont binaries)
 *  - 'atlases': key   -> { kind, fontId, blob, metrics, info } (generated atlases)
 */

const DB_NAME = 'glyph-cache-bench';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts');
      if (!db.objectStoreNames.contains('atlases')) db.createObjectStore('atlases');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function dbGet(store, key) {
  const db = await openDB();
  return tx(db, store, 'readonly', (s) => s.get(key));
}

export async function dbPut(store, key, value) {
  const db = await openDB();
  return tx(db, store, 'readwrite', (s) => s.put(value, key));
}

export async function dbDelete(store, key) {
  const db = await openDB();
  return tx(db, store, 'readwrite', (s) => s.delete(key));
}

export async function dbClear(store) {
  const db = await openDB();
  return tx(db, store, 'readwrite', (s) => s.clear());
}
