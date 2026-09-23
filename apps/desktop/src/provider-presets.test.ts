import { describe, expect, it } from 'vitest';
import {
  getProviderPreset,
  presetDesc,
  presetsByGroup,
  PROVIDER_PRESETS,
} from './provider-presets';

describe('provider-presets', () => {
  it('includes openai and anthropic cloud presets', () => {
    expect(getProviderPreset('openai')?.protocol).toBe('openai-compatible');
    expect(getProviderPreset('anthropic')?.protocol).toBe('anthropic-compatible');
  });

  it('lists the two custom endpoint presets first', () => {
    const groups = presetsByGroup();
    expect(Object.keys(groups)[0]).toBe('custom');
    expect(groups.custom.map((preset) => preset.presetId)).toEqual([
      'custom-openai',
      'custom-anthropic',
    ]);
  });

  it('has unique preset ids and groups', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.presetId);
    expect(new Set(ids).size).toBe(ids.length);
    const grouped = presetsByGroup();
    expect(grouped.cloud.length).toBeGreaterThan(0);
    expect(grouped.local.length).toBeGreaterThan(0);
  });

  it('includes new cloud vendor presets: opencode go, mimo, stepfun, volcengine ark', () => {
    const opencode = getProviderPreset('opencode-go');
    expect(opencode?.protocol).toBe('openai-compatible');
    expect(opencode?.group).toBe('cloud');
    expect(opencode?.baseUrl).toBe('https://opencode.ai/zen/go/v1');
    expect(opencode?.models.length).toBeGreaterThan(0);
    expect(presetDesc(opencode!, true)).toBe('OpenCode 编程模型订阅');

    const mimo = getProviderPreset('mimo');
    expect(mimo?.protocol).toBe('openai-compatible');
    expect(mimo?.group).toBe('cloud');
    expect(mimo?.baseUrl).toBe('https://api.xiaomimimo.com/v1');
    expect(mimo?.models.length).toBeGreaterThan(0);
    expect(presetDesc(mimo!, true)).toBe('小米 MiMo 系列');

    const stepfun = getProviderPreset('stepfun');
    expect(stepfun?.protocol).toBe('openai-compatible');
    expect(stepfun?.group).toBe('cloud');
    expect(stepfun?.baseUrl).toBe('https://api.stepfun.com/v1');
    expect(stepfun?.models.length).toBeGreaterThan(0);
    expect(presetDesc(stepfun!, true)).toBe('阶跃星辰 Step 系列');

    const volcengine = getProviderPreset('volcengine');
    expect(volcengine?.protocol).toBe('openai-compatible');
    expect(volcengine?.group).toBe('cloud');
    expect(volcengine?.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3');
    expect(volcengine?.models.length).toBeGreaterThan(0);
    expect(presetDesc(volcengine!, true)).toBe('火山方舟豆包系列');
  });

  it('resolves vendor preset aliases', () => {
    expect(getProviderPreset('opencode')?.presetId).toBe('opencode-go');
    expect(getProviderPreset('xiaomi')?.presetId).toBe('mimo');
    expect(getProviderPreset('step')?.presetId).toBe('stepfun');
    expect(getProviderPreset('ark')?.presetId).toBe('volcengine');
    expect(getProviderPreset('doubao')?.presetId).toBe('volcengine');
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
