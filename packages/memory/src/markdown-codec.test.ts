import { describe, expect, it } from 'vitest';
import type { MemoryRecord } from '@piwin/contracts';
import { decodeMemoryMarkdown, encodeMemoryMarkdown } from './markdown-codec.js';

describe('markdown codec', () => {
  it('round-trips a record', () => {
    const record: MemoryRecord = {
      id: 'abc-123',
      scope: 'global',
      type: 'user',
      title: 'Hello',
      content: 'Body line\nsecond',
      confidence: 'medium',
      quote: 'Hello world',
      tags: ['a', 'b'],
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T01:00:00.000Z',
      relativePath: 'global/abc-123.md',
    };
    const encoded = encodeMemoryMarkdown(record);
    const decoded = decodeMemoryMarkdown(encoded, record.relativePath!);
    expect(decoded).toMatchObject({
      id: 'abc-123',
      scope: 'global',
      type: 'user',
      title: 'Hello',
      content: 'Body line\nsecond',
      confidence: 'medium',
      quote: 'Hello world',
      tags: ['a', 'b'],
    });
  });
});
