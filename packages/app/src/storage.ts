const DB = 'webhack';
const STORE = 'saves';
const KEY = 'current';

let warned = false;
const warn = (e: unknown): void => {
  if (warned) return;
  warned = true;
  console.warn('webhack: save storage unavailable', e);
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSave(): Promise<string | null> {
  try {
    const v = await withStore<unknown>('readonly', (s) => s.get(KEY));
    return typeof v === 'string' ? v : null;
  } catch (e) {
    warn(e);
    return null;
  }
}

export async function writeSave(text: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(text, KEY));
  } catch (e) {
    warn(e);
  }
}

export async function clearSave(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch (e) {
    warn(e);
  }
}
