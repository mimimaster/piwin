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

  it('includes Google Gemini native and OpenAI-compatible proxy presets', () => {
    const gemini = getProviderPreset('gemini');
    expect(gemini?.protocol).toBe('google-gemini');
    expect(gemini?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(gemini?.apiKeyEnv).toBe('GEMINI_API_KEY');
    expect(gemini?.models.length).toBeGreaterThan(0);

    const proxy = getProviderPreset('gemini-proxy');
    expect(proxy?.protocol).toBe('openai-compatible');
    expect(proxy?.group).toBe('gateway');
  });

  it('only uses supported protocol adapters', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(['openai-compatible', 'anthropic-compatible', 'google-gemini']).toContain(
        preset.protocol,
      );
    }
  });
});
