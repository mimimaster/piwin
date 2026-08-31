import { describe, expect, it } from 'vitest';
import {
  CODEX_LIVE_INTELLIGENCE_ENABLED,
  codexLiveSettingFields,
  validateCodexLiveSettings,
} from './live-settings-schema.js';

describe('Codex Live settings schema', () => {
  it('hides intelligence after AVAS rejected the field', () => {
    expect(CODEX_LIVE_INTELLIGENCE_ENABLED).toBe(false);
    expect(codexLiveSettingFields().some((field) => field.key === 'intelligence')).toBe(false);
    expect(validateCodexLiveSettings({ voice: 'cove' })).toEqual({
      ok: true,
      normalized: { voice: 'cove' },
    });
    expect(validateCodexLiveSettings({ voice: 'cove', intelligence: 'high' }).ok).toBe(false);
  });
});
