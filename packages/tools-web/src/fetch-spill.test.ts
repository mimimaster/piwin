import { describe, expect, it, vi } from 'vitest';
import { attachFetchSpill } from './fetch-spill.js';
import type { FetchStoreRecord } from './fetch-cache.js';
import type { WebFetchResult } from '@piwin/contracts';

const stored: FetchStoreRecord = {
  url: 'https://example.com/long',
  finalUrl: 'https://example.com/long',
  title: 'Long',
  text: 'abcdefghijklmnopqrstuvwxyz',
  contentType: 'text/plain',
  byteSize: 26,
  truncated: false,
  outline: [],
  provider: 'supermarkdown',
};

const head: WebFetchResult = {
  url: stored.url,
  finalUrl: stored.finalUrl,
  title: stored.title,
  text: 'abcdefghij',
  contentType: stored.contentType,
  byteSize: stored.byteSize,
  truncated: false,
  hasMore: true,
  totalChars: 26,
};

describe('attachFetchSpill', () => {
  it('writes the full stored text when the view has more', async () => {
    const write = vi.fn(async () => '/tmp/spill.txt');
    const result = await attachFetchSpill(head, stored, { write });
    expect(write).toHaveBeenCalledWith({ url: stored.finalUrl, text: stored.text });
    expect(result.spillPath).toBe('/tmp/spill.txt');
  });

  it('skips spill when the window already covers the store', async () => {
    const write = vi.fn(async () => '/tmp/spill.txt');
    const result = await attachFetchSpill({ ...head, hasMore: false }, stored, { write });
    expect(write).not.toHaveBeenCalled();
    expect(result.spillPath).toBeUndefined();
  });

  it('does not swallow abort', async () => {
    const write = vi.fn(async () => '/tmp/spill.txt');
    const signal = AbortSignal.abort();
    await expect(attachFetchSpill(head, stored, { write }, signal)).rejects.toThrow(/aborted/);
    expect(write).not.toHaveBeenCalled();
  });
});
