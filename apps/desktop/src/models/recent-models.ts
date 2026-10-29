/** Phone model sheet: the last models the operator picked, newest first. */
export const RECENT_MODELS_KEY = 'piwin.recent-models';
export const RECENT_MODELS_SHOWN = 3;
const RECENT_MODELS_KEPT = 5;

export function readRecentModels(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): string[] {
  try {
    const raw = storage?.getItem(RECENT_MODELS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}

export function pushRecentModel(
  key: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage(),
): string[] {
  const next = [key, ...readRecentModels(storage).filter((existing) => existing !== key)].slice(
    0,
    RECENT_MODELS_KEPT,
  );
  try {
    storage?.setItem(RECENT_MODELS_KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota: the list is a convenience only.
  }
  return next;
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
