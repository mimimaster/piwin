export type PreviewDataUrlOptions = {
  maxCharacters?: number;
  isStale?: () => boolean;
};

function encodeSupportedImage(canvas: HTMLCanvasElement, quality: number): string | null {
  for (const type of ['image/webp', 'image/jpeg'] as const) {
    const url = canvas.toDataURL(type, quality);
    if (url.startsWith(`data:${type};base64,`)) return url;
  }
  return null;
}

/** One decoded bitmap; quality first, then progressively smaller preview copies. */
export async function encodePreviewDataUrl(
  bitmap: ImageBitmap,
  options: PreviewDataUrlOptions = {},
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.toDataURL !== 'function') return null;
  const limit = options.maxCharacters ?? Number.POSITIVE_INFINITY;
  let width = bitmap.width;
  let height = bitmap.height;
  let smallest: string | null = null;
  try {
    while (true) {
      canvas.width = width;
      canvas.height = height;
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.8, 0.65, 0.45]) {
        if (options.isStale?.()) return null;
        const url = encodeSupportedImage(canvas, quality);
        if (url === null) return null;
        if (smallest === null || url.length < smallest.length) smallest = url;
        if (url.length <= limit) return url;
        // Let a changed source/unmount cancel expensive obsolete encodes.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (width === 1 && height === 1) return smallest;
      const scale = Math.min(0.75, Math.sqrt(Math.max(1, limit) / (smallest?.length ?? 1)) * 0.9);
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
