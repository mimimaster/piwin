import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeProviders } from './config-store-providers.js';
import { loadPiwinConfig, savePiwinConfig } from './config-store.js';

function providerWithModel(model: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'magpie',
    name: 'Magpie',
    baseUrl: 'http://127.0.0.1:3425/v1',
    protocol: 'openai-compatible',
    apiKeyRef: 'keychain:piwin-magpie',
    models: [{ id: 'cursor/gpt-5.5@272k', ...model }],
  };
}

describe('normalizeProviders', () => {
  it('returns an empty list for a non-array value', () => {
    expect(normalizeProviders(undefined)).toEqual([]);
    expect(normalizeProviders({})).toEqual([]);
  });

  it('folds OpenAI-style "none" into "off" in thinkingLevels and thinkingLevel', () => {
    const [provider] = normalizeProviders([
      providerWithModel({
        thinkingLevels: ['none', 'low', 'medium', 'high', 'xhigh'],
        thinkingLevel: 'none',
      }),
    ]);
    expect(provider?.models[0]).toMatchObject({
      thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh'],
      thinkingLevel: 'off',
    });
  });

  it('drops the duplicate created when both "none" and "off" are present', () => {
    const [provider] = normalizeProviders([
      providerWithModel({ thinkingLevels: ['off', 'none', 'high'] }),
    ]);
    expect(provider?.models[0]?.thinkingLevels).toEqual(['off', 'high']);
  });

  it('leaves canonical levels, unknown values and other fields untouched', () => {
    const input = providerWithModel({
      thinkingLevels: ['minimal', 'bogus', 'max'],
      thinkingLevel: 'max',
      contextWindow: 272000,
    });
    const [provider] = normalizeProviders([input]);
    expect(provider).toEqual(input);
  });

  it('passes through providers without a models array', () => {
    const input = { id: 'bare', protocol: 'openai-compatible' };
    expect(normalizeProviders([input])).toEqual([input]);
  });
});

describe('loadPiwinConfig provider thinking aliases', () => {
  it('loads an externally written "none" level as "off" so the config saves again', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-thinking-none-'));
    await writeFile(
      join(rootDir, 'config.json'),
      JSON.stringify({
        providers: [
          providerWithModel({
            reasoning: true,
            thinkingLevels: ['none', 'low', 'high'],
            thinkingLevel: 'high',
          }),
        ],
      }),
      'utf8',
    );
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.providers[0]?.models[0]?.thinkingLevels).toEqual(['off', 'low', 'high']);
    await expect(savePiwinConfig(loaded, rootDir)).resolves.toBe(join(rootDir, 'config.json'));
  });
});
