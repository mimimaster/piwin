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
});
