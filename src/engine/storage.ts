import type { Project } from '../types';

const DB_NAME = 'fs-editor';
const DB_VER = 1;

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const saveProject = (p: Project) => tx('projects', 'readwrite', (s) => s.put(p));
export const loadProject = (id: string) => tx<Project | undefined>('projects', 'readonly', (s) => s.get(id));
export const deleteProjectRecord = (id: string) => tx('projects', 'readwrite', (s) => s.delete(id));
export const listProjects = () => tx<Project[]>('projects', 'readonly', (s) => s.getAll());

export const saveMediaBlob = (id: string, blob: Blob) => tx('media', 'readwrite', (s) => s.put(blob, id));
export const loadMediaBlob = (id: string) => tx<Blob | undefined>('media', 'readonly', (s) => s.get(id));
export const deleteMediaBlob = (id: string) => tx('media', 'readwrite', (s) => s.delete(id));

export const setMeta = (key: string, value: unknown) => tx('meta', 'readwrite', (s) => s.put(value, key));
export const getMeta = <T>(key: string) => tx<T | undefined>('meta', 'readonly', (s) => s.get(key));

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* not critical */
  }
}
