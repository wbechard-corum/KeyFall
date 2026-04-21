// Lightweight IndexedDB wrapper for the trainer's saved song library.
// Each song is an object: { id, name, bytes (ArrayBuffer), notes, duration, addedAt }.

const DB_NAME = 'keyfall';
const STORE = 'songs';
const VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('addedAt', 'addedAt', { unique: false });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSong({ name, bytes, notes, duration }) {
  const store = await tx('readwrite');
  return promisify(store.add({ name, bytes, notes, duration, addedAt: Date.now() }));
}

export async function listSongs() {
  const store = await tx('readonly');
  const all = await promisify(store.getAll());
  return all.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getSong(id) {
  const store = await tx('readonly');
  return promisify(store.get(id));
}

export async function deleteSong(id) {
  const store = await tx('readwrite');
  return promisify(store.delete(id));
}

export async function renameSong(id, newName) {
  const store = await tx('readwrite');
  const existing = await promisify(store.get(id));
  if (!existing) return;
  existing.name = newName;
  return promisify(store.put(existing));
}

export function isSupported() {
  return typeof indexedDB !== 'undefined';
}
