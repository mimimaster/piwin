import { describe, expect, it } from 'vitest';
import { extractLeadingJsonObject } from './plan-json.js';

describe('extractLeadingJsonObject', () => {
  it('keeps a complete object and reports leftover bytes', () => {
    const extracted = extractLeadingJsonObject('{"a":1}\nleftover"\n');
    expect(extracted).toEqual({ json: '{"a":1}', trailingGarbage: true });
  });

  it('does not treat braces inside strings as the object end', () => {
    const extracted = extractLeadingJsonObject('{"title":"a } b"}');
    expect(extracted).toEqual({ json: '{"title":"a } b"}', trailingGarbage: false });
  });

  it('returns undefined for truncated documents', () => {
    expect(extractLeadingJsonObject('{"title":"unclosed')).toBeUndefined();
  });

  it('treats escaped quotes as string content', () => {
    expect(extractLeadingJsonObject('{"title":"a\\"b"} leftover')).toEqual({
      json: '{"title":"a\\"b"}',
      trailingGarbage: true,
    });
  });

  it('returns undefined for documents over the scan cap', () => {
    expect(extractLeadingJsonObject(`{${'x'.repeat(65 * 1024)}`)).toBeUndefined();
  });
});
