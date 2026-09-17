import {
  DEFAULT_ATTENTION_PREFERENCES,
  type AttentionPreferences,
} from '@piwin/host-client';

export const ATTENTION_PREFERENCES_KEY = 'piwin.desktop.attention.v1';
export const ATTENTION_LEDGER_KEY = 'piwin.desktop.attention.ledger.v1';
export const ATTENTION_OPT_IN_DISMISSED_KEY = 'piwin.desktop.attention.optInDismissedAt';

const ATTENTION_PREFERENCE_KEYS = [
  'enabled',
  'onNeedsInput',
  'onComplete',
  'onFailure',
  'foregroundToast',
  'badge',
  'sound',
  'bounceOnNeedsInput',
] as const satisfies readonly (keyof AttentionPreferences)[];

const listeners = new Set<(next: AttentionPreferences) => void>();

function defaultStorage(): Storage | undefined {
  try {
    if (typeof window === 'undefined') {
      return undefined;
    }
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function snapshotPreferences(value: AttentionPreferences): AttentionPreferences {
  return {
    enabled: value.enabled,
    onNeedsInput: value.onNeedsInput,
    onComplete: value.onComplete,
    onFailure: value.onFailure,
    foregroundToast: value.foregroundToast,
    badge: value.badge,
    sound: value.sound,
    bounceOnNeedsInput: value.bounceOnNeedsInput,
  };
}

function coercePreferences(value: unknown): AttentionPreferences {
  const next = snapshotPreferences(DEFAULT_ATTENTION_PREFERENCES);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return next;
  }
  const record = value as Record<string, unknown>;
  for (const key of ATTENTION_PREFERENCE_KEYS) {
    if (typeof record[key] === 'boolean') {
      next[key] = record[key];
    }
  }
  return next;
}

function notify(next: AttentionPreferences): void {
  for (const listener of [...listeners]) {
    listener(next);
  }
}

export function readAttentionPreferences(
  storage?: Pick<Storage, 'getItem'>,
): AttentionPreferences {
  const store = storage ?? defaultStorage();
  if (!store) {
    return snapshotPreferences(DEFAULT_ATTENTION_PREFERENCES);
  }
  try {
    const raw = store.getItem(ATTENTION_PREFERENCES_KEY);
    if (raw == null || raw === '') {
      return snapshotPreferences(DEFAULT_ATTENTION_PREFERENCES);
    }
    return coercePreferences(JSON.parse(raw) as unknown);
  } catch {
    return snapshotPreferences(DEFAULT_ATTENTION_PREFERENCES);
  }
}

export function writeAttentionPreferences(
  next: AttentionPreferences,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const snapshot = snapshotPreferences(next);
  const store = storage ?? defaultStorage();
  try {
    store?.setItem(ATTENTION_PREFERENCES_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage may be missing or quota-blocked; subscribers still see the write.
  }
  notify(snapshot);
}

export function subscribeAttentionPreferences(
  listener: (next: AttentionPreferences) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
