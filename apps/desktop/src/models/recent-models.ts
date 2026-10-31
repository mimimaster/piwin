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

export const MODEL_LAST_THINKING_KEY = 'piwin.model-last-thinking';

export function readModelLastThinking(
  modelKey: string,
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): string | undefined {
  try {
    const raw = storage?.getItem(MODEL_LAST_THINKING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const val = (parsed as Record<string, unknown>)[modelKey];
      return typeof val === 'string' ? val : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function saveModelLastThinking(
  modelKey: string,
  level: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage(),
): void {
  try {
    const raw = storage?.getItem(MODEL_LAST_THINKING_KEY);
    const parsed: Record<string, string> =
      raw && typeof JSON.parse(raw) === 'object' && !Array.isArray(JSON.parse(raw))
        ? (JSON.parse(raw) as Record<string, string>)
        : {};
    parsed[modelKey] = level;
    storage?.setItem(MODEL_LAST_THINKING_KEY, JSON.stringify(parsed));
  } catch {
    // Private mode / quota: the preference is a convenience only.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
