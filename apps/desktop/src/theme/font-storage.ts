/**
 * Persistent storage for custom uploaded fonts using IndexedDB.
 * Falls back to an in-memory map when running in environments without IndexedDB.
 */

export interface StoredCustomFont {
  id: string;
  family: string;
  fileName: string;
  format: 'truetype' | 'opentype' | 'woff' | 'woff2';
  data: ArrayBuffer;
  size: number;
  createdAt: number;
}

export type CustomFontInput = {
  family: string;
  fileName: string;
  format: StoredCustomFont['format'];
  data: ArrayBuffer;
};

const DB_NAME = 'piwin-custom-fonts';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

const memoryStore = new Map<string, StoredCustomFont>();

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('family', 'family', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open font database'));
  });
}

function generateFontId(fileName: string): string {
  const cleanName = fileName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  return `font-${cleanName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function saveCustomFont(input: CustomFontInput): Promise<StoredCustomFont> {
  const font: StoredCustomFont = {
    id: generateFontId(input.fileName),
    family: input.family,
    fileName: input.fileName,
    format: input.format,
    data: input.data,
    size: input.data.byteLength,
    createdAt: Date.now(),
  };

  if (!hasIndexedDb()) {
    memoryStore.set(font.id, font);
    return font;
  }

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(font);

    req.onsuccess = () => resolve(font);
    req.onerror = () => reject(req.error ?? new Error('Failed to save font to IndexedDB'));
    tx.oncomplete = () => db.close();
  });
}

export async function listCustomFonts(): Promise<StoredCustomFont[]> {
  if (!hasIndexedDb()) {
    return Array.from(memoryStore.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const list = (req.result as StoredCustomFont[]) ?? [];
        list.sort((a, b) => b.createdAt - a.createdAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to list fonts from IndexedDB'));
      tx.oncomplete = () => db.close();
    });
  } catch {
    return Array.from(memoryStore.values()).sort((a, b) => b.createdAt - a.createdAt);
  }
}

export async function getCustomFont(id: string): Promise<StoredCustomFont | undefined> {
  if (!hasIndexedDb()) {
    return memoryStore.get(id);
  }

  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result as StoredCustomFont | undefined);
      req.onerror = () => reject(req.error ?? new Error(`Failed to get font ${id}`));
      tx.oncomplete = () => db.close();
    });
  } catch {
    return memoryStore.get(id);
  }
}

export async function deleteCustomFont(id: string): Promise<void> {
  memoryStore.delete(id);
  if (!hasIndexedDb()) {
    return;
  }

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error(`Failed to delete font ${id}`));
      tx.oncomplete = () => db.close();
    });
  } catch {
    // Non-fatal if IndexedDB was unavailable
  }
}

export async function clearCustomFonts(): Promise<void> {
  memoryStore.clear();
  if (!hasIndexedDb()) {
    return;
  }

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('Failed to clear fonts'));
      tx.oncomplete = () => db.close();
    });
  } catch {
    // Non-fatal if IndexedDB was unavailable
  }
}
