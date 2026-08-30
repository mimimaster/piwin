// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MediaAttachmentRef } from '@piwin/contracts';
import { MediaPreview } from './MediaPreview';
import * as mediaUtils from './media-utils';
import * as previewBitmap from './media-preview-bitmap';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('MediaPreview', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    document.body
      .querySelectorAll('[data-testid="media-lightbox"]')
      .forEach((node) => node.remove());
  });

  it('resolves a local vault video when no preview URL is supplied', async () => {
    const resolveSpy = vi
      .spyOn(mediaUtils, 'resolveMediaPreviewUrl')
      .mockResolvedValue('asset://video-1.mp4');
    const attachment: MediaAttachmentRef = {
      id: 'video-1',
      kind: 'media',
      path: '/Users/me/.piwin/media/session-1/video-1.mp4',
      mimeType: 'video/mp4',
      byteSize: 2_759_590,
      source: 'generated',
    };

    await act(async () => {
      root.render(<MediaPreview attachment={attachment} sessionId="session-1" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const video = container.querySelector<HTMLVideoElement>('.media-preview-video');
    expect(video).not.toBeNull();
    expect(video?.src).toContain('asset://video-1.mp4');
    expect(container.textContent).not.toContain('video/mp4 · 2759590B');
    resolveSpy.mockRestore();
  });

  it('renders generated videos as an inline controllable video element', () => {
    const attachment: MediaAttachmentRef = {
      id: 'video-1',
      kind: 'media',
      path: '/tmp/piwin/media/session-1/video-1.mp4',
      mimeType: 'video/mp4',
      byteSize: 1024,
      source: 'generated',
    };
    act(() => {
      root.render(<MediaPreview attachment={attachment} previewUrl="asset://video-1.mp4" />);
    });

    const video = container.querySelector<HTMLVideoElement>('.media-preview-video');
    expect(video).not.toBeNull();
    expect(video?.controls).toBe(true);
    expect(video?.hasAttribute('playsinline')).toBe(true);
    expect(video?.src).toContain('asset://video-1.mp4');
  });

  it('opens a fullscreen lightbox when an image thumbnail is clicked', () => {
    const attachment: MediaAttachmentRef = {
      id: 'image-1',
      kind: 'media',
      path: '/tmp/piwin/media/session-1/photo.png',
      mimeType: 'image/png',
      byteSize: 2048,
      source: 'paste',
    };

    act(() => {
      root.render(<MediaPreview attachment={attachment} previewUrl="asset://photo.png" />);
    });

    const openButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="media-preview-open"]',
    );
    expect(openButton).not.toBeNull();
    expect(document.querySelector('[data-testid="media-lightbox"]')).toBeNull();

    act(() => {
      openButton?.click();
    });

    const lightbox = document.querySelector<HTMLElement>('[data-testid="media-lightbox"]');
    const lightboxImage = document.querySelector<HTMLImageElement>(
      '[data-testid="media-lightbox-image"]',
    );
    expect(lightbox).not.toBeNull();
    expect(lightboxImage?.src).toContain('asset://photo.png');
    expect(lightboxImage?.alt).toBe('photo.png');
  });

  it('renders text and document attachments as file cards', () => {
    const attachment: MediaAttachmentRef = {
      id: 'code-1',
      kind: 'media',
      path: '/tmp/piwin/media/session-1/uuid.ts',
      name: 'main.ts',
      mimeType: 'application/typescript',
      contentKind: 'text',
      byteSize: 512,
      source: 'file-picker',
    };

    act(() => {
      root.render(<MediaPreview attachment={attachment} />);
    });

    const card = container.querySelector('[data-testid="media-file-card"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('main.ts');
    expect(card?.textContent).toContain('application/typescript');
    expect(container.querySelector('[data-testid="media-preview-open"]')).toBeNull();
  });

  it('closes the lightbox on Escape and backdrop click without bubbling to parents', () => {
    const attachment: MediaAttachmentRef = {
      id: 'image-2',
      kind: 'media',
      path: '/tmp/piwin/media/session-1/shot.jpg',
      mimeType: 'image/jpeg',
      byteSize: 1024,
      source: 'file-picker',
    };
    let parentClickCount = 0;

    act(() => {
      root.render(
        <div
          data-testid="parent-collapsible"
          onClick={() => {
            parentClickCount += 1;
          }}
        >
          <MediaPreview attachment={attachment} previewUrl="asset://shot.jpg" />
        </div>,
      );
    });

    const openButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="media-preview-open"]',
    );
    act(() => {
      openButton?.click();
    });
    expect(parentClickCount).toBe(0);
    expect(document.querySelector('[data-testid="media-lightbox"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-testid="media-lightbox"]')).toBeNull();

    act(() => {
      openButton?.click();
    });
    const lightbox = document.querySelector<HTMLElement>('[data-testid="media-lightbox"]');
    expect(lightbox).not.toBeNull();

    act(() => {
      lightbox?.click();
    });
    expect(document.querySelector('[data-testid="media-lightbox"]')).toBeNull();
    expect(parentClickCount).toBe(0);
  });

  it('keeps the lightbox on the original URL when the thumb is limited', () => {
    const attachment: MediaAttachmentRef = {
      id: 'image-3',
      kind: 'media',
      path: '/tmp/piwin/media/session-1/photo.png',
      mimeType: 'image/png',
      byteSize: 2048,
      source: 'paste',
    };

    act(() => {
      root.render(
        <MediaPreview
          attachment={attachment}
          previewUrl="blob:thumb"
          lightboxUrl="asset://photo.png"
        />,
      );
    });

    const thumb = container.querySelector<HTMLImageElement>('.media-preview-image');
    expect(thumb?.src).toContain('blob:thumb');

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="media-preview-open"]')?.click();
    });
    const lightboxImage = document.querySelector<HTMLImageElement>(
      '[data-testid="media-lightbox-image"]',
    );
    expect(lightboxImage?.src).toContain('asset://photo.png');
  });

  it('downscales transcript asset URLs for the thumb only', async () => {
    const resolveSpy = vi
      .spyOn(mediaUtils, 'resolveMediaPreviewUrl')
      .mockResolvedValue('asset://photo.png');
    const limitSpy = vi
      .spyOn(previewBitmap, 'createLimitedPreviewUrlFromHref')
      .mockResolvedValue({ url: 'blob:transcript-thumb', owned: true });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const attachment: MediaAttachmentRef = {
      id: 'image-4',
      kind: 'media',
      path: '/tmp/piwin/media/session-1/photo.png',
      mimeType: 'image/png',
      byteSize: 4096,
      source: 'file-picker',
    };

    await act(async () => {
      root.render(<MediaPreview attachment={attachment} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(resolveSpy).toHaveBeenCalledWith(attachment.path);
    expect(limitSpy).toHaveBeenCalledWith('asset://photo.png', 1024);
    const thumb = container.querySelector<HTMLImageElement>('.media-preview-image');
    expect(thumb?.src).toContain('blob:transcript-thumb');

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="media-preview-open"]')?.click();
    });
    const lightboxImage = document.querySelector<HTMLImageElement>(
      '[data-testid="media-lightbox-image"]',
    );
    expect(lightboxImage?.src).toContain('asset://photo.png');

    act(() => root.unmount());
    expect(revokeSpy).toHaveBeenCalledWith('blob:transcript-thumb');

    resolveSpy.mockRestore();
    limitSpy.mockRestore();
    revokeSpy.mockRestore();
    root = createRoot(container);
  });

  it('loads remote-asset thumbs through media/read when convertFileSrc cannot resolve', async () => {
    const resolveSpy = vi
      .spyOn(mediaUtils, 'resolveMediaPreviewUrl')
      .mockResolvedValue(null);
    const limitSpy = vi
      .spyOn(previewBitmap, 'createLimitedPreviewUrlFromHref')
      .mockResolvedValue({ url: 'blob:host-thumb', owned: true });
    const readMedia = vi.fn(async () => 'blob:host-full');

    const attachment: MediaAttachmentRef = {
      id: 'asset-9',
      kind: 'media',
      path: 'remote-asset:asset-9',
      mimeType: 'image/png',
      byteSize: 78865,
      source: 'paste',
    };

    await act(async () => {
      root.render(
        <MediaPreview attachment={attachment} sessionId="sess-1" readMedia={readMedia} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readMedia).toHaveBeenCalledWith({ sessionId: 'sess-1', assetId: 'asset-9' });
    const thumb = container.querySelector<HTMLImageElement>('.media-preview-image');
    expect(thumb?.src).toContain('blob:host-thumb');
    expect(container.textContent).not.toContain('image/png · 78865B');

    resolveSpy.mockRestore();
    limitSpy.mockRestore();
  });
});
