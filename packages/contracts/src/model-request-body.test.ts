import { describe, expect, it } from 'vitest';
import {
  MAX_REQUEST_BODY_BYTES,
  mergeModelRequestBody,
  resolveModelRequestBody,
  validateModelRequestBody,
} from './model-request-body.js';

describe('validateModelRequestBody', () => {
  it('accepts OpenRouter provider routing', () => {
    expect(
      validateModelRequestBody({ provider: { order: ['anthropic', 'google-vertex'], allow_fallbacks: false } }),
    ).toEqual([]);
  });

  it('rejects non-objects and reserved top-level keys', () => {
    expect(validateModelRequestBody([1])).toEqual([{ code: 'not-object' }]);
    expect(validateModelRequestBody('x')).toEqual([{ code: 'not-object' }]);
    expect(validateModelRequestBody({ model: 'x', messages: [], temperature: 1 })).toEqual([
      { code: 'reserved-key', key: 'model' },
      { code: 'reserved-key', key: 'messages' },
    ]);
  });

  it('allows reserved names below the top level', () => {
    expect(validateModelRequestBody({ provider: { model: 'x' } })).toEqual([]);
  });

  it('rejects non-JSON values, deep nesting and oversized bodies', () => {
    expect(validateModelRequestBody({ a: { b: Number.NaN } })).toEqual([{ code: 'not-json', path: 'a.b' }]);
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let level = 0; level < 9; level += 1) deep = { nested: deep };
    expect(validateModelRequestBody(deep)).toEqual([{ code: 'too-deep', limitDepth: 8 }]);
    expect(validateModelRequestBody({ big: 'x'.repeat(MAX_REQUEST_BODY_BYTES) })).toEqual([
      { code: 'too-large', limitBytes: MAX_REQUEST_BODY_BYTES },
    ]);
  });
});

describe('mergeModelRequestBody', () => {
  const payload = {
    model: 'anthropic/claude-sonnet-4.5',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    reasoning: { effort: 'medium', summary: 'auto' },
    store: false,
  };

  it('deep-merges objects, replaces arrays and scalars, deletes on null', () => {
    const merged = mergeModelRequestBody(payload, {
      provider: { order: ['anthropic'], allow_fallbacks: false },
      reasoning: { effort: 'high' },
      store: null,
      stop: ['END'],
    });
    expect(merged).toEqual({
      model: 'anthropic/claude-sonnet-4.5',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      reasoning: { effort: 'high', summary: 'auto' },
      provider: { order: ['anthropic'], allow_fallbacks: false },
      stop: ['END'],
    });
    expect(payload.store).toBe(false);
  });

  it('never touches reserved top-level keys', () => {
    const merged = mergeModelRequestBody(payload, { model: 'evil', stream: false } as never);
    expect(merged).toEqual(payload);
  });

  it('leaves non-object payloads alone', () => {
    expect(mergeModelRequestBody('raw', { a: 1 })).toBe('raw');
    expect(mergeModelRequestBody(payload, undefined)).toBe(payload);
  });
});

describe('resolveModelRequestBody', () => {
  it('returns a valid body and ignores empty, invalid or subscription ones', () => {
    const body = { provider: { only: ['anthropic'] } };
    expect(resolveModelRequestBody({}, { extraBody: body })).toBe(body);
    expect(resolveModelRequestBody({}, { extraBody: {} })).toBeUndefined();
    expect(resolveModelRequestBody({}, { extraBody: { model: 'x' } })).toBeUndefined();
    expect(resolveModelRequestBody({ source: 'subscription' }, { extraBody: body })).toBeUndefined();
    expect(resolveModelRequestBody({}, undefined)).toBeUndefined();
  });
});
