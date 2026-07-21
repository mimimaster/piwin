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

  it('includes Gemini-class OpenAI-compatible presets', () => {
    const gemini = getProviderPreset('gemini');
    expect(gemini?.protocol).toBe('openai-compatible');
    expect(gemini?.baseUrl).toContain('generativelanguage.googleapis.com');
    expect(gemini?.apiKeyEnv).toBe('GEMINI_API_KEY');
    expect(gemini?.models.length).toBeGreaterThan(0);

    const proxy = getProviderPreset('gemini-proxy');
    expect(proxy?.protocol).toBe('openai-compatible');
    expect(proxy?.group).toBe('gateway');
  });

  it('only uses openai-compatible or anthropic-compatible protocols', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(['openai-compatible', 'anthropic-compatible']).toContain(preset.protocol);
    }
  });

