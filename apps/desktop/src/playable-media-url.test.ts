import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayableMediaObjectUrl } from './playable-media-url';

describe('createPlayableMediaObjectUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches an asset URL and returns a typed object URL', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes, { status: 200 })),
    );
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:playable-1');

    const url = await createPlayableMediaObjectUrl('http://asset.localhost/clip.mp4', 'video/mp4');

    expect(url).toBe('blob:playable-1');
    expect(createSpy).toHaveBeenCalledTimes(1);
    const blob = createSpy.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('video/mp4');
    expect((blob as Blob).size).toBe(4);
  });

  it('returns null for blob/data URLs and failed fetches', async () => {
    expect(await createPlayableMediaObjectUrl('blob:already', 'video/mp4')).toBeNull();
    expect(await createPlayableMediaObjectUrl('', 'video/mp4')).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(
      await createPlayableMediaObjectUrl('http://asset.localhost/missing.mp4', 'video/mp4'),
    ).toBeNull();
  });
});
