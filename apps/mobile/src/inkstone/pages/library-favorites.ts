/**
 * Device-local 收藏 for the phone library.
 *
 * Same storage key and `sessionId:assetId` keys as the desktop vault, because
 * a favorite is a personal reading preference, not Host state — there is no
 * `media/favorite` command and inventing one is out of scope.
 */
import { mobileLocalStorage } from '../../mobile-local-storage.js';

export const LIBRARY_FAVORITES_STORAGE_KEY = 'piwin.media_vault.favorites';

export function loadLibraryFavorites(storage: Storage | undefined = mobileLocalStorage()): Set<string> {
  if (storage === undefined) return new Set();
  try {
    const raw = storage.getItem(LIBRARY_FAVORITES_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return new Set();
  }
}

export function saveLibraryFavorites(
  favorites: ReadonlySet<string>,
  storage: Storage | undefined = mobileLocalStorage(),
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(LIBRARY_FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]));
  } catch {
    // Storage is a device convenience; a full or blocked quota keeps the
    // in-memory set working for this session.
  }
}

export function toggleLibraryFavorite(
  favorites: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(favorites);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
