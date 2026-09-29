import { describe, expect, it } from 'vitest';
import { applyNativeSearchToPayload } from './native-search-payload.js';

const apply = (
  payload: Record<string, unknown>,
  adapter: Parameters<typeof applyNativeSearchToPayload>[1],
  options?: Parameters<typeof applyNativeSearchToPayload>[2],
): Record<string, unknown> =>
  applyNativeSearchToPayload(payload, adapter, options) as Record<string, unknown>;

describe('native search payload shaping', () => {
  it('OpenAI Responses uses web_search (never preview) and optional sources include', () => {
    expect(apply({ include: ['reasoning.encrypted_content'] }, 'openai-responses-tool')).toEqual({
      tools: [{ type: 'web_search' }],
      include: ['reasoning.encrypted_content', 'web_search_call.action.sources'],
    });
    expect(
      apply({}, 'openai-responses-tool', { openaiResponses: { includeSources: false } }),
    ).toEqual({ tools: [{ type: 'web_search' }] });
  });

  it('xAI uses the Responses web_search tool and never x_search', () => {
    const payload = apply({}, 'xai-web-search-tool');
    expect(payload.tools).toEqual([{ type: 'web_search' }]);
    expect(JSON.stringify(payload)).not.toContain('x_search');
  });

  it('Chat Completions web_search_options only for its adapter', () => {
    expect(apply({}, 'openai-web-search-options')).toEqual({ web_search_options: {} });
    expect(apply({}, 'openai-responses-tool').web_search_options).toBeUndefined();
  });

  it('Anthropic honours tool version and defaults allowed_callers for newer versions', () => {
    expect(apply({}, 'anthropic-web-search-tool').tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    ]);
    expect(apply({}, 'anthropic-web-search-tool', { anthropic: { toolType: 'web_search_20260209' } }).tools).toEqual([
      { type: 'web_search_20260209', name: 'web_search', max_uses: 5, allowed_callers: ['direct'] },
    ]);
    expect(
      apply({}, 'anthropic-web-search-tool', {
        anthropic: { toolType: 'web_search_20260318', allowedCallers: ['direct', 'code_execution_20260120'] },
      }).tools,
    ).toEqual([
      {
        type: 'web_search_20260318',
        name: 'web_search',
        max_uses: 5,
        allowed_callers: ['direct', 'code_execution_20260120'],
      },
    ]);
  });

  it('Gemini keeps the @google/genai googleSearch shape', () => {
    expect(apply({ config: {} }, 'google-search-tool')).toEqual({ config: { tools: [{ googleSearch: {} }] } });
  });

  it('fails closed without an adapter', () => {
    expect(apply({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
});
