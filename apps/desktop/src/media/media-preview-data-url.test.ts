// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLimitedDataUrl } from './media-preview-bitmap.js';

function mockImageEncoder() {
  const close = vi.fn();
  const encoded: Array<{ width: number; height: number; quality: number }> = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 96, height: 54, close }) as unknown as ImageBitmap),
  );
  const nativeCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') return nativeCreateElement(tag);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: vi.fn((_type: string, quality: number) => {
        encoded.push({ width: canvas.width, height: canvas.height, quality });
        const length = Math.round(((10000 * canvas.width * canvas.height) / (96 * 54)) * quality);
        return `data:image/webp;base64,${'A'.repeat(length)}`;
      }),
    };
    return canvas as unknown as HTMLCanvasElement;
  });
  return { close, encoded };
}

describe('budgeted image encoding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reduces quality before changing image dimensions', async () => {
    const { encoded, close } = mockImageEncoder();
    const url = await createLimitedDataUrl(new Blob(['image']), 96, { maxCharacters: 6000 });
    expect(url?.length).toBeLessThanOrEqual(6000);
    expect(encoded.length).toBeGreaterThan(1);
    expect(encoded.every((sample) => sample.width === 96 && sample.height === 54)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it('reduces dimensions when quality alone cannot fit the allocation', async () => {
    const { encoded, close } = mockImageEncoder();
    const url = await createLimitedDataUrl(new Blob(['image']), 96, { maxCharacters: 1000 });
    expect(url?.length).toBeLessThanOrEqual(1000);
    expect(encoded.some((sample) => sample.width < 96 && sample.height < 54)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not recompress an image that already fits', async () => {
    const { encoded } = mockImageEncoder();
    const url = await createLimitedDataUrl(new Blob(['image']), 96, { maxCharacters: 9000 });
    expect(url?.length).toBeLessThanOrEqual(9000);
    expect(encoded).toHaveLength(1);
  });

  it('stops obsolete work and releases the bitmap', async () => {
    const { close, encoded } = mockImageEncoder();
    const url = await createLimitedDataUrl(new Blob(['image']), 96, {
      maxCharacters: 1000,
      isStale: () => encoded.length > 0,
    });
    expect(url).toBeNull();
    expect(encoded).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce();
  });
});
