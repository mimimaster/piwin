import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireMediaPreviewUrl,
  MAX_IDLE_MEDIA_PREVIEW_URLS,
  releaseMediaPreviewUrl,
  resetMediaPreviewUrlCacheForTests,
} from './media-preview-url-cache';

describe('media preview url cache', () => {
  let revoked: string[];

  beforeEach(() => {
    resetMediaPreviewUrlCacheForTests();
    revoked = [];
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(String(url));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function acquire(key: string): Promise<string | null> {
    return acquireMediaPreviewUrl(key, async () => `blob:${key}`);
  }

  it('loads once for concurrent and repeat reads', async () => {
    const load = vi.fn(async () => 'blob:a');
    const [first, second] = await Promise.all([
      acquireMediaPreviewUrl('a', load),
      acquireMediaPreviewUrl('a', load),
    ]);
    const third = await acquireMediaPreviewUrl('a', load);

    expect([first, second, third]).toEqual(['blob:a', 'blob:a', 'blob:a']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a miss', async () => {
    const load = vi.fn(async () => null);
    expect(await acquireMediaPreviewUrl('a', load)).toBeNull();
    expect(await acquireMediaPreviewUrl('a', load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never revokes a leased url, however many others go idle', async () => {
    const held = await acquire('held');
    for (let index = 0; index < MAX_IDLE_MEDIA_PREVIEW_URLS + 4; index += 1) {
      releaseMediaPreviewUrl(await acquire(`idle-${index}`));
    }

    expect(revoked).not.toContain(held);
    expect(revoked).toEqual(['blob:idle-0', 'blob:idle-1', 'blob:idle-2', 'blob:idle-3']);
  });

  it('keeps a url alive until its last lease is released', async () => {
    const first = await acquire('shared');
    const second = await acquire('shared');
    releaseMediaPreviewUrl(first);
    for (let index = 0; index <= MAX_IDLE_MEDIA_PREVIEW_URLS; index += 1) {
      releaseMediaPreviewUrl(await acquire(`idle-${index}`));
    }
    expect(revoked).not.toContain('blob:shared');

    releaseMediaPreviewUrl(second);
    for (let index = 0; index < MAX_IDLE_MEDIA_PREVIEW_URLS; index += 1) {
      releaseMediaPreviewUrl(await acquire(`later-${index}`));
    }
    expect(revoked).toContain('blob:shared');
  });

  it('reloads a url after it was revoked', async () => {
    const load = vi.fn(async () => 'blob:a');
    releaseMediaPreviewUrl(await acquireMediaPreviewUrl('a', load));
    for (let index = 0; index < MAX_IDLE_MEDIA_PREVIEW_URLS; index += 1) {
      releaseMediaPreviewUrl(await acquire(`idle-${index}`));
    }
    expect(revoked).toEqual(['blob:a']);

    await acquireMediaPreviewUrl('a', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ignores urls it did not issue and extra releases', async () => {
    const url = await acquire('a');
    releaseMediaPreviewUrl('blob:foreign');
    releaseMediaPreviewUrl(null);
    releaseMediaPreviewUrl(url);
    releaseMediaPreviewUrl(url);
    expect(revoked).toEqual([]);
  });
});
