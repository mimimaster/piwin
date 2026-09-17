import {
  DEFAULT_ATTENTION_PREFERENCES,
  type AttentionPreferences,
} from '@piwin/host-client';

export const MOBILE_ATTENTION_PREFERENCES_KEY = 'piwin.mobile.attention.v1';
export const MOBILE_ATTENTION_LEDGER_KEY = 'piwin.mobile.attention.ledger.v1';

export type MobileAttentionSwitches = {
  onNeedsInput: boolean;
  onComplete: boolean;
  onFailure: boolean;
};

const SWITCH_KEYS = ['onNeedsInput', 'onComplete', 'onFailure'] as const;

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    if (typeof window === 'undefined') {
      return undefined;
    }
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function mobileSwitchesFromPreferences(
  preferences: AttentionPreferences,
): MobileAttentionSwitches {
  return {
    onNeedsInput: preferences.onNeedsInput,
    onComplete: preferences.onComplete,
    onFailure: preferences.onFailure,
  };
}

export function preferencesFromMobileSwitches(
  switches: MobileAttentionSwitches,
): AttentionPreferences {
  const enabled = switches.onNeedsInput || switches.onComplete || switches.onFailure;
  return {
    ...DEFAULT_ATTENTION_PREFERENCES,
    enabled,
    onNeedsInput: switches.onNeedsInput,
    onComplete: switches.onComplete,
    onFailure: switches.onFailure,
    badge: false,
    bounceOnNeedsInput: false,
  };
}

export function readMobileAttentionPreferences(
  storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): AttentionPreferences {
  if (storage === undefined) {
    return preferencesFromMobileSwitches(mobileSwitchesFromPreferences(DEFAULT_ATTENTION_PREFERENCES));
  }
  try {
    const raw = storage.getItem(MOBILE_ATTENTION_PREFERENCES_KEY);
    if (raw == null || raw === '') {
      return preferencesFromMobileSwitches(mobileSwitchesFromPreferences(DEFAULT_ATTENTION_PREFERENCES));
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return preferencesFromMobileSwitches(mobileSwitchesFromPreferences(DEFAULT_ATTENTION_PREFERENCES));
    }
    const record = parsed as Record<string, unknown>;
    const switches: MobileAttentionSwitches = {
      onNeedsInput: typeof record.onNeedsInput === 'boolean' ? record.onNeedsInput : true,
      onComplete: typeof record.onComplete === 'boolean' ? record.onComplete : true,
      onFailure: typeof record.onFailure === 'boolean' ? record.onFailure : true,
    };
    return preferencesFromMobileSwitches(switches);
  } catch {
    return preferencesFromMobileSwitches(mobileSwitchesFromPreferences(DEFAULT_ATTENTION_PREFERENCES));
  }
}

export function writeMobileAttentionPreferences(
  next: MobileAttentionSwitches,
  storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): AttentionPreferences {
  const preferences = preferencesFromMobileSwitches(next);
  if (storage !== undefined) {
    storage.setItem(
      MOBILE_ATTENTION_PREFERENCES_KEY,
      JSON.stringify({
        onNeedsInput: next.onNeedsInput,
        onComplete: next.onComplete,
        onFailure: next.onFailure,
      }),
    );
  }
  return preferences;
}

export function readMobileAttentionSwitches(
  storage?: Pick<Storage, 'getItem'>,
): MobileAttentionSwitches {
  return mobileSwitchesFromPreferences(readMobileAttentionPreferences(storage));
}

void SWITCH_KEYS;
