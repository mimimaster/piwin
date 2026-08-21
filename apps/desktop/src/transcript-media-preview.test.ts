import { afterEach, describe, expect, it, vi } from 'vitest';
import * as mediaUtils from './media-utils';
import * as previewBitmap from './media-preview-bitmap';
import {
  mediaPreviewAssetId,
  readMediaPreviewViaHost,
  resolveTranscriptPreviewUrls,
} from './transcript-media-preview';

describe('mediaPreviewAssetId', () => {
  it('skips composer pending chips', () => {
    expect(mediaPreviewAssetId('pending://chip-1', 'chip-1')).toBeNull();
  });

  it('prefers the remote-asset ref over the attachment id', () => {
    expect(mediaPreviewAssetId('remote-asset:asset-9', 'other')).toBe('asset-9');
  });

  it('falls back to the attachment id for vault or redacted paths', () => {
    expect(mediaPreviewAssetId('/Users/me/.piwin/media/sess/a.png', 'asset-1')).toBe('asset-1');
    expect(mediaPreviewAssetId('[host-path]', 'asset-1')).toBe('asset-1');
  });
});

describe('readMediaPreviewViaHost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a blob URL for a ready media/read payload and reuses the cache', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:media-1');
    const request = vi.fn(async () => ({
      success: true,
      data: {
        status: 'ready',
        assetId: 'asset-1',
        sessionId: 'sess-1',
        mimeType: 'image/png',
        byteSize: 4,
        base64Data: 'AQIDBA==',
      },
    }));
    const host = { request, supportsCommand: () => true as const };

    const first = await readMediaPreviewViaHost(host, { sessionId: 'sess-1', assetId: 'asset-1' });
    const second = await readMediaPreviewViaHost(host, { sessionId: 'sess-1', assetId: 'asset-1' });

    expect(first).toBe('blob:media-1');
    expect(second).toBe('blob:media-1');
    expect(request).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when the Host marks the asset unavailable', async () => {
    const host = {
      request: vi.fn(async () => ({
        success: true,
        data: { status: 'unavailable', reason: 'not-found' },
      })),
    };
    const url = await readMediaPreviewViaHost(host, { sessionId: 'sess-1', assetId: 'missing' });
    expect(url).toBeNull();
  });
});

describe('resolveTranscriptPreviewUrls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses convertFileSrc when the vault path is local', async () => {
    vi.spyOn(mediaUtils, 'resolveMediaPreviewUrl').mockResolvedValue('asset://photo.png');
    vi.spyOn(previewBitmap, 'createLimitedPreviewUrlFromHref').mockResolvedValue({
      url: 'blob:thumb',
      owned: true,
    });
    const readMedia = vi.fn(async () => 'blob:host');

    const result = await resolveTranscriptPreviewUrls({
      path: '/Users/me/.piwin/media/sess/photo.png',
      assetId: 'asset-1',
      sessionId: 'sess',
      isVideo: false,
      readMedia,
    });

    expect(result).toEqual({
      thumbUrl: 'blob:thumb',
      fullUrl: 'asset://photo.png',
      ownedThumb: 'blob:thumb',
    });
    expect(readMedia).not.toHaveBeenCalled();
  });

  it('falls back to media/read when convertFileSrc cannot resolve the path', async () => {
    vi.spyOn(mediaUtils, 'resolveMediaPreviewUrl').mockResolvedValue(null);
    vi.spyOn(previewBitmap, 'createLimitedPreviewUrlFromHref').mockResolvedValue({
      url: 'blob:host-thumb',
      owned: true,
    });
    const readMedia = vi.fn(async () => 'blob:host');

    const result = await resolveTranscriptPreviewUrls({
      path: 'remote-asset:asset-9',
      assetId: 'asset-9',
      sessionId: 'sess-1',
      isVideo: false,
      readMedia,
    });

    expect(readMedia).toHaveBeenCalledWith({ sessionId: 'sess-1', assetId: 'asset-9' });
    expect(result).toEqual({
      thumbUrl: 'blob:host-thumb',
      fullUrl: 'blob:host',
      ownedThumb: 'blob:host-thumb',
    });
  });

  it('skips convertFileSrc when skipLocal is set', async () => {
    const localSpy = vi
      .spyOn(mediaUtils, 'resolveMediaPreviewUrl')
      .mockResolvedValue('asset://stale.png');
    vi.spyOn(previewBitmap, 'createLimitedPreviewUrlFromHref').mockResolvedValue({
      url: 'blob:host-thumb',
      owned: true,
    });
    const readMedia = vi.fn(async () => 'blob:host');

    const result = await resolveTranscriptPreviewUrls({
      path: '/Users/me/.piwin/media/sess/photo.png',
      assetId: 'asset-1',
      sessionId: 'sess',
      isVideo: false,
      readMedia,
      skipLocal: true,
    });

    expect(localSpy).not.toHaveBeenCalled();
    expect(readMedia).toHaveBeenCalledWith({ sessionId: 'sess', assetId: 'asset-1' });
    expect(result.fullUrl).toBe('blob:host');
  });
});
