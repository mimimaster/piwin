import { describe, expect, it } from 'vitest';
import {
  getProviderPreset,
  presetsByGroup,
  PROVIDER_PRESETS,
} from './provider-presets';

describe('provider-presets', () => {
  it('includes openai and anthropic cloud presets', () => {
    expect(getProviderPreset('openai')?.protocol).toBe('openai-compatible');
    expect(getProviderPreset('anthropic')?.protocol).toBe('anthropic-compatible');
  });

  it('has unique preset ids and groups', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.presetId);
    expect(new Set(ids).size).toBe(ids.length);
    const grouped = presetsByGroup();
    expect(grouped.cloud.length).toBeGreaterThan(0);
    expect(grouped.local.length).toBeGreaterThan(0);
  });
});
