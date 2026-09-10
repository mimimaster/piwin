import { describe, expect, it } from 'vitest';
import { REMOTE_MEDIA_ASSET_PREFIX, type MediaLibraryItem } from '@piwin/contracts';
import {
  buildLibraryMediaImageTarget,
  buildMediaImageTarget,
  isOpaqueMediaName,
  mediaAttachmentFromLibraryItem,
  mediaDownloadFileName,
} from './media-image-target.js';

describe('mediaDownloadFileName', () => {
  it('keeps a real filename untouched', () => {
    expect(mediaDownloadFileName('hero.png', 'image/png')).toBe('hero.png');
  });

  it('replaces an opaque asset ref with an extension from the mime type', () => {
    expect(mediaDownloadFileName(`${REMOTE_MEDIA_ASSET_PREFIX}f01f236b`, 'image/webp')).toBe(
      'image.webp',
    );
    expect(mediaDownloadFileName('', 'image/jpeg')).toBe('image.jpg');
    expect(mediaDownloadFileName('a3f1c2d4-1111-2222-3333-444455556666', 'image/unknown')).toBe(
      'image.png',
    );
  });

  it('detects opaque names', () => {
    expect(isOpaqueMediaName(`${REMOTE_MEDIA_ASSET_PREFIX}x`)).toBe(true);
    expect(isOpaqueMediaName('diagram.svg')).toBe(false);
  });
});

describe('buildMediaImageTarget', () => {
  it('keeps a local vault path and file name', () => {
    const target = buildMediaImageTarget({
      attachment: {
        id: 'asset-1',
        kind: 'media',
        path: '/Users/me/.piwin/media/s1/asset-1.png',
        mimeType: 'image/png',
        byteSize: 12,
        source: 'generated',
        name: 'icon.png',
      },
      sessionId: 's1',
      srcUrl: 'blob:full',
    });
    expect(target).toMatchObject({
      surface: 'media-image',
      fileName: 'icon.png',
      absolutePath: '/Users/me/.piwin/media/s1/asset-1.png',
      srcUrl: 'blob:full',
      sessionId: 's1',
      assetId: 'asset-1',
    });
    expect(target.inLightbox).toBeUndefined();
  });

  it('omits absolutePath for remote-asset refs', () => {
    const target = buildMediaImageTarget({
      attachment: {
        id: 'asset-2',
        kind: 'media',
        path: `${REMOTE_MEDIA_ASSET_PREFIX}asset-2`,
        mimeType: 'image/webp',
        byteSize: 8,
        source: 'generated',
      },
    });
    expect(target.absolutePath).toBeUndefined();
    expect(target.fileName).toBe(`${REMOTE_MEDIA_ASSET_PREFIX}asset-2`);
  });
});

describe('mediaAttachmentFromLibraryItem', () => {
  it('uses the vault path when present and remote-asset otherwise', () => {
    const local: MediaLibraryItem = {
      assetId: 'a1',
      sessionId: 's1',
      mimeType: 'image/png',
      byteSize: 4,
      createdAt: '2026-09-09T00:00:00.000Z',
      kind: 'image',
      absolutePath: '/Users/me/.piwin/media/s1/a1.png',
      name: 'hero.png',
    };
    expect(mediaAttachmentFromLibraryItem(local)).toMatchObject({
      id: 'a1',
      path: '/Users/me/.piwin/media/s1/a1.png',
      name: 'hero.png',
      source: 'generated',
    });
    const remote: MediaLibraryItem = {
      assetId: 'a2',
      sessionId: 's2',
      mimeType: 'image/png',
      byteSize: 4,
      createdAt: '2026-09-09T00:00:00.000Z',
      kind: 'image',
    };
    expect(mediaAttachmentFromLibraryItem(remote).path).toBe(`${REMOTE_MEDIA_ASSET_PREFIX}a2`);
    expect(buildLibraryMediaImageTarget(remote, { inLightbox: true }).inLightbox).toBe(true);
  });
});
