import { describe, expect, it } from 'vitest';
import {
  applyRequestBodyTemplate,
  formatRequestBodyText,
  isOpenRouterBaseUrl,
  parseHeadersJsonText,
  parseRequestBodyText,
  parseUpstreamList,
  readOpenRouterRouting,
  REQUEST_BODY_TEMPLATES,
  writeOpenRouterRouting,
} from './model-request-overrides.js';

describe('parseRequestBodyText', () => {
  it('treats blank and {} as no body', () => {
    expect(parseRequestBodyText('  ')).toEqual({ ok: true, body: undefined });
    expect(parseRequestBodyText('{}')).toEqual({ ok: true, body: undefined });
  });

  it('reports syntax errors and contract issues separately', () => {
    const syntax = parseRequestBodyText('{"a":');
    expect(syntax.ok).toBe(false);
    expect(!syntax.ok && syntax.error.kind).toBe('syntax');
    expect(parseRequestBodyText('{"stream": false}')).toEqual({
      ok: false,
      error: { kind: 'issue', issue: { code: 'reserved-key', key: 'stream' } },
    });
    expect(parseRequestBodyText('[1]')).toEqual({
      ok: false,
      error: { kind: 'issue', issue: { code: 'not-object' } },
    });
  });

  it('round-trips through formatRequestBodyText', () => {
    const body = { provider: { order: ['anthropic'] } };
    expect(parseRequestBodyText(formatRequestBodyText(body))).toEqual({ ok: true, body });
    expect(formatRequestBodyText(undefined)).toBe('');
  });
});

describe('parseHeadersJsonText', () => {
  it('accepts a string map and rejects bad shapes', () => {
    expect(parseHeadersJsonText('{" X-Title ": "piwin"}')).toEqual({
      ok: true,
      headers: { 'X-Title': 'piwin' },
    });
    expect(parseHeadersJsonText('{"X-N": 1}')).toEqual({
      ok: false,
      error: { kind: 'not-string', name: 'X-N' },
    });
    expect(parseHeadersJsonText('{"a": "1", "A": "2"}')).toEqual({
      ok: false,
      error: { kind: 'duplicate', name: 'A' },
    });
    expect(parseHeadersJsonText('{"bad name": "1"}')).toEqual({
      ok: false,
      error: { kind: 'invalid-name', name: 'bad name' },
    });
    expect(parseHeadersJsonText('[]')).toEqual({ ok: false, error: { kind: 'not-object' } });
  });
});

describe('templates', () => {
  it('merges a template into the existing body instead of replacing it', () => {
    const template = REQUEST_BODY_TEMPLATES.find((item) => item.id === 'openrouter-upstream');
    if (!template) throw new Error('missing template');
    const result = applyRequestBodyTemplate('{"provider": {"sort": "price"}, "temperature": 1}', template.body);
    expect(result.ok && JSON.parse(result.text)).toEqual({
      provider: { sort: 'price', order: ['anthropic'], allow_fallbacks: false },
      temperature: 1,
    });
  });

  it('keeps null deletions literally', () => {
    const template = REQUEST_BODY_TEMPLATES.find((item) => item.id === 'remove-field');
    if (!template) throw new Error('missing template');
    const result = applyRequestBodyTemplate('', template.body);
    expect(result.ok && JSON.parse(result.text)).toEqual({ store: null });
  });

  it('refuses to merge into invalid JSON', () => {
    expect(applyRequestBodyTemplate('{', { a: 1 }).ok).toBe(false);
  });
});

describe('OpenRouter routing', () => {
  it('detects OpenRouter base URLs only', () => {
    expect(isOpenRouterBaseUrl('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouterBaseUrl('https://eu.openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouterBaseUrl('https://openrouter.ai.evil.test/v1')).toBe(false);
    expect(isOpenRouterBaseUrl('not a url')).toBe(false);
    expect(isOpenRouterBaseUrl(undefined)).toBe(false);
  });

  it('reads defaults and writes only non-default fields, keeping others', () => {
    expect(readOpenRouterRouting(undefined)).toEqual({ order: [], allowFallbacks: true, sort: '' });
    const body = writeOpenRouterRouting(
      { temperature: 0.2, provider: { require_parameters: true } },
      { order: ['anthropic'], allowFallbacks: false, sort: 'throughput' },
    );
    expect(body).toEqual({
      temperature: 0.2,
      provider: {
        require_parameters: true,
        order: ['anthropic'],
        allow_fallbacks: false,
        sort: 'throughput',
      },
    });
    expect(readOpenRouterRouting(body)).toEqual({
      order: ['anthropic'],
      allowFallbacks: false,
      sort: 'throughput',
    });
  });

  it('drops an emptied provider object and an emptied body', () => {
    expect(
      writeOpenRouterRouting({ provider: { order: ['a'] } }, { order: [], allowFallbacks: true, sort: '' }),
    ).toBeUndefined();
  });

  it('parses comma, full-width comma and whitespace separated slugs', () => {
    expect(parseUpstreamList('anthropic，google-vertex  amazon-bedrock, anthropic,')).toEqual([
      'anthropic',
      'google-vertex',
      'amazon-bedrock',
    ]);
  });
});
