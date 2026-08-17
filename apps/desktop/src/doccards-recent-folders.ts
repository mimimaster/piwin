/**
 * Storage helper for recently opened document folders in Knowledge Center.
 */
const RECENT_FOLDERS_KEY = 'piwin.doccards.recent_folders';
const MAX_RECENT_FOLDERS = 6;

export function loadRecentFolders(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FOLDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

export function saveRecentFolder(folderPath: string): string[] {
  const trimmed = folderPath.trim();
  if (!trimmed) return loadRecentFolders();
  try {
    const current = loadRecentFolders().filter((f) => f !== trimmed);
    const updated = [trimmed, ...current].slice(0, MAX_RECENT_FOLDERS);
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [trimmed];
  }
}

export function removeRecentFolder(folderPath: string): string[] {
  const trimmed = folderPath.trim();
  try {
    const updated = loadRecentFolders().filter((f) => f !== trimmed);
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}
