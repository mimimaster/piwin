/**
 * Detect non-transparent bounding box inside sprite cells.
 *
 * Pixel-art spritesheets often have generous cell padding for animation frames.
 * Cropping tight non-transparent bounds makes the pet container, speech bubble anchor,
 * and drag hit box fit snuggly around the actual pet character.
 */

export type PetContentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function defaultPetContentBounds(cellWidth: number, cellHeight: number): PetContentBounds {
  const safeW = Math.max(1, Math.round(cellWidth || 48));
  const safeH = Math.max(1, Math.round(cellHeight || 52));
  return { x: 0, y: 0, width: safeW, height: safeH };
}

/**
 * Scan non-zero alpha pixel boundaries across cell frames.
 * Returns tight bounding box with 2px safety padding, or full cell bounds if unavailable.
 */
export function detectPetContentBounds(
  img: HTMLImageElement | null,
  cellWidth: number,
  cellHeight: number,
  cols = 8,
  rows = 9,
): PetContentBounds {
  const fallback = defaultPetContentBounds(cellWidth, cellHeight);
  if (!img || typeof window === 'undefined') return fallback;
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) return fallback;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = fallback.width;
    canvas.height = fallback.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;

    let minX = fallback.width;
    let minY = fallback.height;
    let maxX = 0;
    let maxY = 0;
    let foundPixel = false;

    // Check first 2 rows of frames (idle and action animations)
    const checkRows = Math.max(1, Math.min(rows || 1, 2));
    const checkCols = Math.max(1, Math.min(cols || 1, 8));

    for (let r = 0; r < checkRows; r++) {
      for (let c = 0; c < checkCols; c++) {
        const srcX = c * fallback.width;
        const srcY = r * fallback.height;
        if (srcX >= naturalW || srcY >= naturalH) continue;

        ctx.clearRect(0, 0, fallback.width, fallback.height);
        ctx.drawImage(
          img,
          srcX,
          srcY,
          fallback.width,
          fallback.height,
          0,
          0,
          fallback.width,
          fallback.height,
        );

        const imgData = ctx.getImageData(0, 0, fallback.width, fallback.height);
        const data = imgData.data;

        for (let y = 0; y < fallback.height; y++) {
          for (let x = 0; x < fallback.width; x++) {
            const alpha = data[(y * fallback.width + x) * 4 + 3];
            if (alpha !== undefined && alpha > 15) {
              foundPixel = true;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
      }
    }

    if (!foundPixel || minX >= maxX || minY >= maxY) {
      return fallback;
    }

    // Add 2px safety padding without overflowing cell boundaries
    const safeMinX = Math.max(0, minX - 2);
    const safeMinY = Math.max(0, minY - 2);
    const safeMaxX = Math.min(fallback.width, maxX + 3);
    const safeMaxY = Math.min(fallback.height, maxY + 3);

    return {
      x: safeMinX,
      y: safeMinY,
      width: safeMaxX - safeMinX,
      height: safeMaxY - safeMinY,
    };
  } catch {
    return fallback;
  }
}
