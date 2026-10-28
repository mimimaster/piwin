/**
 * Persistent storage for the uploaded wallpaper image (IndexedDB, like
 * theme/font-storage.ts). Uploads are decoded and downscaled to a JPEG first:
 * the shell never needs more than a screen of pixels and the stored copy stays
 * small. Falls back to memory where IndexedDB is unavailable.
 */

const DB_NAME = 'piwin-wallpaper';
const DB_VERSION = 1;
const STORE_NAME = 'images';
/** Longest edge kept after downscaling; covers a 5K display at 1x. */
export const WALLPAPER_MAX_EDGE = 2880;
const WALLPAPER_JPEG_QUALITY = 0.88;

const memoryStore = new Map<string, Blob>();

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open wallpaper database'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Wallpaper storage failed'));
    });
  } finally {
    db.close();
  }
}

export function scaleToMaxEdge(
  width: number,
  height: number,
  maxEdge: number = WALLPAPER_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width, height };
  }
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Decodes an uploaded image and re-encodes it at screen resolution. */
export async function prepareWallpaperBlob(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = scaleToMaxEdge(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas is not available');
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Wallpaper encoding failed'))),
        'image/jpeg',
        WALLPAPER_JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}

export async function saveWallpaperImage(blob: Blob): Promise<string> {
  const id = `wallpaper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (!hasIndexedDb()) {
    memoryStore.set(id, blob);
    return id;
  }
  await withStore('readwrite', (store) => store.put(blob, id));
  return id;
}

export async function loadWallpaperImage(id: string): Promise<Blob | undefined> {
  if (!hasIndexedDb()) {
    return memoryStore.get(id);
  }
  try {
    const stored = await withStore<unknown>('readonly', (store) => store.get(id));
    return stored instanceof Blob ? stored : undefined;
  } catch {
    return memoryStore.get(id);
  }
}

export async function deleteWallpaperImage(id: string): Promise<void> {
  memoryStore.delete(id);
  if (!hasIndexedDb()) {
    return;
  }
  try {
    await withStore('readwrite', (store) => store.delete(id));
  } catch {
    // Non-fatal: an orphaned image only costs disk space.
  }
}
