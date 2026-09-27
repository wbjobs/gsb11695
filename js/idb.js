// IndexedDB 极简封装：字体二进制与派生资源的持久化。

const DB_NAME = 'glyph-render-demo';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

function asPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idb = {
  putFont: (record) => tx('fonts', 'readwrite', (s) => s.put(record)),
  getFont: (id) => tx('fonts', 'readonly', (s) => asPromise(s.get(id))),
  listFonts: () => tx('fonts', 'readonly', (s) => asPromise(s.getAll())),
  deleteFont: (id) => tx('fonts', 'readwrite', (s) => s.delete(id)),
  clearFonts: () => tx('fonts', 'readwrite', (s) => s.clear()),
};
