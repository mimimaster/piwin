// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaDocPreview } from './MediaDocPreview';
import { resolveMediaPreviewUrl } from './media-utils';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./media-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./media-utils.js')>();
  return {
    ...actual,
    resolveMediaPreviewUrl: vi.fn(async () => 'asset://resolved/media.png' as string | null),
  };
});

function query(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

describe('MediaDocPreview', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  function render(props: Parameters<typeof MediaDocPreview>[0]): void {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<MediaDocPreview {...props} />));
  }

  beforeEach(() => {
    vi.mocked(resolveMediaPreviewUrl).mockClear();
    vi.mocked(resolveMediaPreviewUrl).mockResolvedValue('asset://resolved/media.png');
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('renders vault images from the resolved asset URL', async () => {
    render({ media: { path: '/Users/t/.piwin/media/session-1/a.png' } });
    await act(async () => {});

    const image = query('media-doc-image');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe('asset://resolved/media.png');
    expect(query('media-doc-provenance')?.textContent).toContain('会话媒体');
  });

  it('prefers pre-fetched dataUrl bytes over the asset protocol', async () => {
    render({
      media: {
        path: 'gen.png',
        assetId: 'asset-9',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AQIDBA==',
      },
    });
    await act(async () => {});

    expect(resolveMediaPreviewUrl).not.toHaveBeenCalled();
    expect(query('media-doc-image')?.getAttribute('src')).toBe('data:image/png;base64,AQIDBA==');
  });

  it('zooms with the wheel and resets on double-click', async () => {
    render({ media: { path: '/Users/t/.piwin/media/session-1/a.png' } });
    await act(async () => {});

    const stage = query('media-doc-stage');
    expect(stage).not.toBeNull();
    await act(async () => {
      stage?.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }),
      );
    });
    expect(query('media-doc-zoom-hud')?.textContent).toContain('%');

    const image = query('media-doc-image');
    await act(async () => {
      image?.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
      );
    });
    expect(query('media-doc-zoom-hud')?.textContent).toContain('100%');
  });

  it('renders videos with a native video element', async () => {
    render({ media: { path: '/Users/t/.piwin/media/session-1/clip.mp4' } });
    await act(async () => {});

    expect(query('media-doc-video')).not.toBeNull();
    expect(query('media-doc-image')).toBeNull();
  });

  it('shows an explicit unavailable state when byte resolution fails', async () => {
    vi.mocked(resolveMediaPreviewUrl).mockResolvedValue(null);
    render({ media: { path: '/Users/t/.piwin/media/session-1/gone.png' } });
    await act(async () => {});

    const state = query('media-doc-state-unavailable');
    expect(state).not.toBeNull();
    expect(state?.textContent).toContain('无法加载预览');
    expect(state?.textContent).toContain('媒体文件当前无法读取');
    expect(state?.textContent).not.toContain('Ref');
    expect(query('media-doc-image')).toBeNull();
  });
});
