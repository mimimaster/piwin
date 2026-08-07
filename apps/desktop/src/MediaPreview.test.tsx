// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MediaAttachmentRef } from '@piwin/contracts';
import { MediaPreview } from './MediaPreview';

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
    document.body.querySelectorAll('[data-testid="media-lightbox"]').forEach((node) => node.remove());
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

    const openButton = container.querySelector<HTMLButtonElement>('[data-testid="media-preview-open"]');
    expect(openButton).not.toBeNull();
    expect(document.querySelector('[data-testid="media-lightbox"]')).toBeNull();

    act(() => {
      openButton?.click();
    });

    const lightbox = document.querySelector<HTMLElement>('[data-testid="media-lightbox"]');
    const lightboxImage = document.querySelector<HTMLImageElement>('[data-testid="media-lightbox-image"]');
    expect(lightbox).not.toBeNull();
    expect(lightboxImage?.src).toContain('asset://photo.png');
    expect(lightboxImage?.alt).toBe('photo.png');
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

    const openButton = container.querySelector<HTMLButtonElement>('[data-testid="media-preview-open"]');
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
});
