import { describe, expect, it } from 'vitest';
import {
  applyDiscoveredNativeSearch,
  compatibleNativeSearchAdapters,
  inferNativeSearchAdapter,
  isNativeSearchAdapterCompatible,
  isNativeSearchAdapterKind,
  nativeSearchProtocolSwitch,
  resolveNativeSearchAdapter,
  suggestDiscoveredNativeSearch,
} from './native-search-adapters.js';

describe('native search adapter compatibility', () => {
  it('filters adapters by protocol, independent of chat transport', () => {
    expect(compatibleNativeSearchAdapters('openai-compatible')).toEqual([
      'openai-responses-tool',
      'openai-web-search-options',
      'xai-web-search-tool',
    ]);
    expect(compatibleNativeSearchAdapters('openai-compatible', 'openai-responses')).toEqual([
      'openai-responses-tool',
      'openai-web-search-options',
      'xai-web-search-tool',
    ]);
    expect(compatibleNativeSearchAdapters('anthropic-compatible')).toEqual(['anthropic-web-search-tool']);
    expect(compatibleNativeSearchAdapters('google-gemini')).toEqual(['google-search-tool']);
  });

  it('limits an identified vendor to its own adapters; gateways keep every protocol shape', () => {
    expect(compatibleNativeSearchAdapters('openai-compatible', undefined, 'oauth://xai')).toEqual([
      'xai-web-search-tool',
    ]);
    expect(compatibleNativeSearchAdapters('openai-compatible', undefined, 'https://api.x.ai/v1')).toEqual([
      'xai-web-search-tool',
    ]);
    expect(compatibleNativeSearchAdapters('openai-compatible', undefined, 'https://api.openai.com/v1')).toEqual([
      'openai-responses-tool',
      'openai-web-search-options',
    ]);
    expect(
      compatibleNativeSearchAdapters('openai-compatible', undefined, 'https://gateway.example/v1'),
    ).toHaveLength(3);
    // A saved OpenAI shape on an xAI host fails closed instead of being sent to xAI.
    expect(
      resolveNativeSearchAdapter({
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        nativeSearchAdapter: 'openai-responses-tool',
      }),
    ).toBeUndefined();
  });

  it('uses the model-id family on an unidentified gateway', () => {
    const gateway = 'http://127.0.0.1:8317/v1';
    // Gemini behind an OpenAI gateway row: no OpenAI/xAI shape, nothing inferred.
    expect(compatibleNativeSearchAdapters('openai-compatible', undefined, gateway, 'gemini-3.8-flash-high')).toEqual([]);
    expect(
      inferNativeSearchAdapter({ protocol: 'openai-compatible', baseUrl: gateway, modelId: 'gemini-3.8-flash-high' }),
    ).toBeUndefined();
    expect(
      nativeSearchProtocolSwitch({ protocol: 'openai-compatible', baseUrl: gateway, modelId: 'gemini-3.8-flash-high' }),
    ).toBe('google-gemini');
    // Same model switched to the Gemini protocol.
    expect(
      resolveNativeSearchAdapter({ protocol: 'google-gemini', baseUrl: 'http://127.0.0.1:8317/v1beta', modelId: 'gemini-3.8-flash-high' }),
    ).toBe('google-search-tool');
    // Grok via gateway → xAI shape only; unknown ids keep every OpenAI-protocol shape.
    expect(compatibleNativeSearchAdapters('openai-compatible', undefined, gateway, 'grok-4.7')).toEqual(['xai-web-search-tool']);
    expect(inferNativeSearchAdapter({ protocol: 'openai-compatible', baseUrl: gateway, modelId: 'grok-4.7' })).toBe(
      'xai-web-search-tool',
    );
    expect(compatibleNativeSearchAdapters('openai-compatible', undefined, gateway, 'my-model')).toHaveLength(3);
    expect(nativeSearchProtocolSwitch({ protocol: 'openai-compatible', modelId: 'my-model' })).toBeUndefined();
  });

  it('fails closed for unknown adapters and missing protocol', () => {
    expect(isNativeSearchAdapterCompatible('openai-compatible', undefined, 'openrouter' as never)).toBe(
      false,
    );
    expect(isNativeSearchAdapterCompatible(undefined, undefined, 'google-search-tool')).toBe(false);
    expect(isNativeSearchAdapterKind('openrouter')).toBe(false);
    expect(isNativeSearchAdapterKind('vendor-specific')).toBe(false);
  });
});

describe('native search adapter inference', () => {
  it('infers official vendor adapters from protocol and host', () => {
    expect(inferNativeSearchAdapter({ protocol: 'google-gemini' })).toBe('google-search-tool');
    expect(inferNativeSearchAdapter({ protocol: 'anthropic-compatible' })).toBe('anthropic-web-search-tool');
    expect(
      inferNativeSearchAdapter({
        protocol: 'openai-compatible',
        baseUrl: 'https://api.x.ai/v1',
      }),
    ).toBe('xai-web-search-tool');
    expect(
      inferNativeSearchAdapter({
        protocol: 'openai-compatible',
        modelId: 'gpt-4o',
      }),
    ).toBe('openai-responses-tool');
    expect(
      inferNativeSearchAdapter({
        protocol: 'openai-compatible',
        modelId: 'gpt-4o-search-preview',
      }),
    ).toBe('openai-web-search-options');
  });

  it('keeps an explicit compatible adapter and drops an incompatible one', () => {
    expect(
      resolveNativeSearchAdapter({
        protocol: 'openai-compatible',
        nativeSearchAdapter: 'openai-web-search-options',
      }),
    ).toBe('openai-web-search-options');
    expect(
      resolveNativeSearchAdapter({
        protocol: 'google-gemini',
        nativeSearchAdapter: 'openai-responses-tool',
      }),
    ).toBeUndefined();
  });
});

describe('discovered native search tagging', () => {
  it('tags official OpenAI / Anthropic / Gemini / xAI chat models', () => {
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4o',
      }),
    ).toMatchObject({ adapter: 'openai-responses-tool' });
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        modelId: 'claude-sonnet-4-20250514',
      }),
    ).toMatchObject({ adapter: 'anthropic-web-search-tool' });
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelId: 'gemini-2.5-flash',
      }),
    ).toMatchObject({ adapter: 'google-search-tool' });
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'openai-compatible',
        baseUrl: 'https://api.x.ai/v1',
        modelId: 'grok-4',
      }),
    ).toMatchObject({ adapter: 'xai-web-search-tool' });
  });

  it('treats the Grok subscription origin as xAI', () => {
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        modelId: 'grok-4.7',
      }),
    ).toMatchObject({ adapter: 'xai-web-search-tool' });
    expect(
      inferNativeSearchAdapter({ protocol: 'openai-compatible', baseUrl: 'oauth://xai' }),
    ).toBe('xai-web-search-tool');
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'openai-compatible',
        baseUrl: 'oauth://openai-codex',
        modelId: 'gpt-5',
      }),
    ).toBeUndefined();
  });

  it('does not tag pass-through aggregators, embeddings, or unsupported families', () => {
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'gpt-4o',
      }),
    ).toBeUndefined();
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'text-embedding-3-small',
      }),
    ).toBeUndefined();
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        modelId: 'claude-3-opus-20240229',
      }),
    ).toBeUndefined();
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelId: 'gemini-1.5-flash',
      }),
    ).toBeUndefined();
  });

  it('tags search-capable families on a self-hosted gateway only when the protocol can express it', () => {
    const cpa = 'http://127.0.0.1:8317/v1';
    expect(
      suggestDiscoveredNativeSearch({ protocol: 'openai-compatible', baseUrl: cpa, modelId: 'grok-4.7' }),
    ).toMatchObject({ adapter: 'xai-web-search-tool' });
    expect(
      suggestDiscoveredNativeSearch({ protocol: 'openai-compatible', baseUrl: cpa, modelId: 'gpt-5.4' }),
    ).toMatchObject({ adapter: 'openai-responses-tool' });
    // Gemini on an OpenAI row cannot run Gemini search: left untagged.
    expect(
      suggestDiscoveredNativeSearch({ protocol: 'openai-compatible', baseUrl: cpa, modelId: 'gemini-3.8-flash-high' }),
    ).toBeUndefined();
    // The same model on its own wire (per-model protocol, rebased URL) is tagged.
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'google-gemini',
        baseUrl: 'http://127.0.0.1:8317/v1beta',
        modelId: 'gemini-3.8-flash-high',
      }),
    ).toMatchObject({ adapter: 'google-search-tool' });
    // Unknown families, and gateway-prefixed ids on aggregators, stay untagged.
    expect(
      suggestDiscoveredNativeSearch({ protocol: 'openai-compatible', baseUrl: cpa, modelId: 'glm-4.1v-thinking-flash' }),
    ).toBeUndefined();
    expect(
      suggestDiscoveredNativeSearch({
        protocol: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'google/gemini-2.5-flash',
      }),
    ).toBeUndefined();
  });

  it('fills a discovered adapter without overwriting an existing one', () => {
    const tagged = applyDiscoveredNativeSearch(
      { id: 'gpt-4o' },
      { protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
    );
    expect(tagged.nativeSearchAdapter).toBe('openai-responses-tool');
    expect(tagged.capabilities).toEqual(['chat', 'native-web-search']);
    const kept = applyDiscoveredNativeSearch(
      { id: 'gpt-4o', nativeSearchAdapter: 'openai-web-search-options' },
      { protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
    );
    expect(kept.nativeSearchAdapter).toBe('openai-web-search-options');
  });
});
