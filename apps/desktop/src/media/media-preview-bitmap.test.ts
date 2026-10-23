// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginComposerImagePreview,
  createLimitedPreviewUrl,
  createLimitedPreviewUrlFromHref,
  scaleToMaxEdge,
} from './media-preview-bitmap';

describe('createLimitedPreviewUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests a resized bitmap and returns an owned object URL', async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(async (_source: Blob, options?: ImageBitmapOptions) => {
      expect(options?.resizeWidth).toBe(96);
      expect(options?.resizeQuality).toBe('low');
      return { width: 96, height: 54, close } as unknown as ImageBitmap;
    });
    vi.stubGlobal('createImageBitmap', createImageBitmap);

    const toBlob = vi.fn((callback: (blob: Blob | null) => void) => {
      callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
    });
    const getContext = vi.fn(() => ({ drawImage: vi.fn() }));
    const nativeCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return { width: 0, height: 0, getContext, toBlob } as unknown as HTMLCanvasElement;
      }
      return nativeCreateElement(tag);
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:limited');

    const source = new Blob([new Uint8Array(800)], { type: 'image/png' });
    const result = await createLimitedPreviewUrl(source, 96);

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(result).toEqual({ url: 'blob:limited', owned: true });
  });

  it('caps the long edge on a portrait bitmap after width-only resize', async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(async (source: Blob | HTMLCanvasElement, options?: ImageBitmapOptions) => {
      if (options?.resizeWidth === 96) {
        return { width: 96, height: 192, close } as unknown as ImageBitmap;
      }
      const canvas = source as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height, close } as unknown as ImageBitmap;
    });
    vi.stubGlobal('createImageBitmap', createImageBitmap);

    const toBlob = vi.fn((callback: (blob: Blob | null) => void) => {
      callback(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
    });
    const getContext = vi.fn(() => ({ drawImage: vi.fn() }));
    const nativeCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return { width: 0, height: 0, getContext, toBlob } as unknown as HTMLCanvasElement;
      }
      return nativeCreateElement(tag);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:limited');

    const result = await createLimitedPreviewUrl(
      new Blob([new Uint8Array(800)], { type: 'image/png' }),
      96,
    );

    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(createImageBitmap.mock.calls[1]?.[0]).toMatchObject({ width: 48, height: 96 });
    expect(close).toHaveBeenCalled();
    expect(result.owned).toBe(true);
  });

  it('falls back to an owned original URL when decode throws', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('decode failed');
    }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:original');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const source = new Blob([new Uint8Array([0x89])], { type: 'image/png' });
    const result = await createLimitedPreviewUrl(source, 96);

    expect(result).toEqual({ url: 'blob:original', owned: true });
    expect(createObjectURL).toHaveBeenCalledWith(source);
    expect(warn).toHaveBeenCalled();
  });
});

describe('scaleToMaxEdge', () => {
  it('leaves landscape and portrait inside the cap alone', () => {
    expect(scaleToMaxEdge(96, 54, 96)).toEqual({ width: 96, height: 54 });
    expect(scaleToMaxEdge(48, 96, 96)).toEqual({ width: 48, height: 96 });
  });

  it('scales a tall frame so the long edge matches the cap', () => {
    expect(scaleToMaxEdge(96, 192, 96)).toEqual({ width: 48, height: 96 });
    expect(scaleToMaxEdge(4000, 3000, 96)).toEqual({ width: 96, height: 72 });
  });
});

describe('createLimitedPreviewUrlFromHref', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the original href unowned when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await createLimitedPreviewUrlFromHref('asset://photo.png', 256);
    expect(result).toEqual({ url: 'asset://photo.png', owned: false });
  });
});

describe('beginComposerImagePreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('revokes the limited URL when the chip is already cancelled', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 96, height: 54, close }) as unknown as ImageBitmap),
    );
    const nativeCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (callback: (blob: Blob | null) => void) => {
            callback(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
          },
        } as unknown as HTMLCanvasElement;
      }
      return nativeCreateElement(tag);
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) =>
      obj instanceof File ? 'blob:lightbox' : 'blob:limited',
    );
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const onReady = vi.fn();

    beginComposerImagePreview(
      new File([new Uint8Array([0x89])], 'shot.png', { type: 'image/png' }),
      onReady,
      () => true,
    );
    await vi.waitFor(() => {
      expect(revoke).toHaveBeenCalledWith('blob:limited');
    });
    expect(onReady).not.toHaveBeenCalled();
  });
});
