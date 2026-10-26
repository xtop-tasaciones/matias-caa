// Almacenamiento local en IndexedDB. Nada sale del dispositivo.
const DB_NAME = 'matias-caa';
const DB_VERSION = 2;
export const STORES = ['cards', 'boards', 'media', 'kv', 'log'];

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('log')) {
        const s = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts');
      }
      // Copia de seguridad automática antes de importar o restablecer (no viaja en el respaldo)
      if (!db.objectStoreNames.contains('copias')) db.createObjectStore('copias', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // Si otra pestaña trae una versión nueva de la base, se cede para no bloquearla
      req.result.onversionchange = () => { req.result.close(); dbp = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    Promise.resolve(fn(t.objectStore(store))).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const get = (store, key) => tx(store, 'readonly', s => wrap(s.get(key)));
export const getAll = (store) => tx(store, 'readonly', s => wrap(s.getAll()));
export const put = (store, val) => tx(store, 'readwrite', s => { s.put(val); });
export const del = (store, key) => tx(store, 'readwrite', s => { s.delete(key); });
export const clear = (store) => tx(store, 'readwrite', s => { s.clear(); });
export const putMany = (store, vals) => tx(store, 'readwrite', s => { for (const v of vals) s.put(v); });
export const add = (store, val) => tx(store, 'readwrite', s => { s.add(val); });

// Reemplaza varios almacenes en una sola transacción: o se guarda todo, o no cambia nada.
export async function replaceAll(data) {
  const db = await open();
  const names = Object.keys(data);
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, 'readwrite');
    for (const n of names) {
      const s = t.objectStore(n);
      s.clear();
      for (const v of data[n]) s.put(v);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Foto de todo lo que hay ahora, guardada aparte; se puede volver a ella con restoreSnapshot().
export async function saveSnapshot(reason) {
  const data = {};
  for (const st of STORES) data[st] = await getAll(st);
  await put('copias', { id: 'ultima', created: Date.now(), reason, data });
}
export const getSnapshot = () => get('copias', 'ultima');
export async function restoreSnapshot() {
  const snap = await getSnapshot();
  if (!snap) return false;
  await replaceAll(snap.data);
  return true;
}

export async function getKV(key, fallback) {
  const r = await get('kv', key);
  return r ? r.value : fallback;
}
export const setKV = (key, value) => put('kv', { key, value });

export function uid(prefix = 'x') {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Medios (fotos y audios) se guardan como ArrayBuffer: funciona igual en iPhone y Android.
const urlCache = new Map();
export async function saveMedia(blob) {
  const id = uid('m');
  const data = await blob.arrayBuffer();
  await put('media', { id, type: blob.type || 'application/octet-stream', data });
  return id;
}
export async function mediaURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const m = await get('media', id);
  if (!m) return null;
  const url = URL.createObjectURL(new Blob([m.data], { type: m.type }));
  urlCache.set(id, url);
  return url;
}
export function mediaURLSync(id) { return urlCache.get(id) || null; }
export async function preloadMedia() {
  const all = await getAll('media');
  for (const m of all) {
    if (!urlCache.has(m.id)) urlCache.set(m.id, URL.createObjectURL(new Blob([m.data], { type: m.type })));
  }
}
export function forgetMedia(id) {
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(id);
}
