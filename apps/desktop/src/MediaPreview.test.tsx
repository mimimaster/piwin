// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { MediaAttachmentRef } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
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
      .mockResolvedValue('http://asset.localhost/video-1.mp4');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:playable-local');
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
    expect(video?.src).toContain('blob:playable-local');
    expect(container.textContent).not.toContain('video/mp4 · 2759590B');
    resolveSpy.mockRestore();
    createSpy.mockRestore();
    vi.unstubAllGlobals();
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

  it('opens a media-image context menu with Save As and Copy Image', () => {
    const attachment: MediaAttachmentRef = {
      id: 'image-menu',
      kind: 'media',
      path: '/Users/me/.piwin/media/session-1/photo.png',
      mimeType: 'image/png',
      byteSize: 2048,
      source: 'generated',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MediaPreview attachment={attachment} previewUrl="asset://photo.png" />
        </PiwinUiProvider>,
      );
    });

    const trigger = container.querySelector<HTMLElement>('[data-testid="media-preview-container"]');
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(document.body.querySelector('[data-testid="context-menu-save-as"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="context-menu-copy-image"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="context-menu-open"]')).not.toBeNull();
  });

  it('opens the media-image menu from the expanded lightbox', () => {
    const attachment: MediaAttachmentRef = {
      id: 'image-lightbox-menu',
      kind: 'media',
      path: '/Users/me/.piwin/media/session-1/photo.png',
      mimeType: 'image/png',
      byteSize: 2048,
      source: 'generated',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MediaPreview attachment={attachment} previewUrl="asset://photo.png" />
        </PiwinUiProvider>,
      );
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="media-preview-open"]')?.click();
    });
    const lightboxImage = document.querySelector<HTMLElement>(
      '[data-testid="media-lightbox-image"]',
    );
    expect(lightboxImage).not.toBeNull();
    act(() => {
      lightboxImage?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
    });
    expect(document.body.querySelector('[data-testid="context-menu-save-as"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="context-menu-copy-image"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="context-menu-open"]')).toBeNull();
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

  it('reserves a hero frame while a generated image is still resolving', () => {
    const attachment: MediaAttachmentRef = {
      id: 'hero-pending',
      kind: 'media',
      path: '/tmp/piwin/media/session-1/wallpaper.png',
      mimeType: 'image/png',
      byteSize: 2_000_000,
      source: 'generated',
    };
    act(() => {
      root.render(<MediaPreview attachment={attachment} hero sessionId="session-1" />);
    });
    const placeholder = container.querySelector('[data-testid="media-preview-loading"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.classList.contains('is-hero')).toBe(true);
    expect(container.querySelector('.media-preview-image')).toBeNull();
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

  it('loads a redacted generated video through media/read instead of preview failed', async () => {
    const resolveSpy = vi.spyOn(mediaUtils, 'resolveMediaPreviewUrl').mockResolvedValue(null);
    const readMedia = vi.fn(async () => 'blob:host-video');
    const attachment: MediaAttachmentRef = {
      id: 'asset-vid',
      kind: 'media',
      path: '[host-path]',
      mimeType: 'video/mp4',
      byteSize: 1_475_051,
      source: 'generated',
    };

    await act(async () => {
      root.render(
        <MediaPreview attachment={attachment} sessionId="sess-1" readMedia={readMedia} />,
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(readMedia).toHaveBeenCalledWith({ sessionId: 'sess-1', assetId: 'asset-vid' });
      });
    });
    const video = container.querySelector<HTMLVideoElement>('.media-preview-video');
    expect(video).not.toBeNull();
    expect(video?.src).toContain('blob:host-video');
    expect(container.textContent).not.toContain('preview failed');
    expect(container.textContent).not.toContain('video/mp4 · 1475051B');

    resolveSpy.mockRestore();
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
