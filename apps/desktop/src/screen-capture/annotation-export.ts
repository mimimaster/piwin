/**
 * Rasterize an annotated screenshot region to PNG at full image resolution
 * (spec 2026-10-25 §6.4). The editor view is scaled; this never is.
 */
import {
  annotationStyle,
  arrowGeometry,
  type AnnotationDocument,
  type AnnotationShape,
  type AnnotationStyle,
  type ImagePoint,
  type ImageRect,
  type ImageSize,
} from './annotation-model.js';

/** Shared with the SVG view so on-screen text matches the exported text. */
export const ANNOTATION_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
export const ANNOTATION_FONT_WEIGHT = 600;

export class AnnotationExportError extends Error {
  override readonly name = 'AnnotationExportError';
}

function createCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = window.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new AnnotationExportError('Canvas 2D context is unavailable');
  }
  return { canvas, context };
}

/**
 * One pixel per mosaic block. Drawn back up with smoothing off it is the
 * mosaic; the view shows it with `image-rendering: pixelated`.
 */
export function createMosaicSource(
  image: CanvasImageSource,
  size: ImageSize,
  blockSize: number,
): HTMLCanvasElement {
  const { canvas, context } = createCanvas(
    Math.max(1, Math.ceil(size.width / blockSize)),
    Math.max(1, Math.ceil(size.height / blockSize)),
  );
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * The mosaic source scaled back up with smoothing off, `pixelsPerBlock` per
 * block, so the view shows hard blocks (SVG ignores `image-rendering` in
 * some engines). Sized near screen resolution to keep it cheap.
 */
export function createMosaicPreview(
  image: CanvasImageSource,
  size: ImageSize,
  blockSize: number,
  pixelsPerBlock: number,
): HTMLCanvasElement {
  const source = createMosaicSource(image, size, blockSize);
  const scale = Math.max(1, Math.round(pixelsPerBlock));
  const { canvas, context } = createCanvas(source.width * scale, source.height * scale);
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function exportAnnotatedPng(
  image: CanvasImageSource,
  document: AnnotationDocument,
  region: ImageRect,
): Promise<Blob> {
  const { canvas, context } = createCanvas(region.width, region.height);
  context.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );
  context.translate(-region.x, -region.y);
  const style = annotationStyle(document.image);
  drawMosaic(context, image, document, region, style);
  drawAnnotationShapes(context, document.shapes, style);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new AnnotationExportError('PNG encoding failed'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

/** Mosaic strokes mask a pixelated copy of the screenshot (under the marks). */
function drawMosaic(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  document: AnnotationDocument,
  region: ImageRect,
  style: AnnotationStyle,
): void {
  const strokes = document.shapes.filter((shape) => shape.kind === 'mosaic');
  if (strokes.length === 0) {
    return;
  }
  const source = createMosaicSource(image, document.image, style.mosaicBlockSize);
  const layer = createCanvas(region.width, region.height).context;
  layer.translate(-region.x, -region.y);
  layer.strokeStyle = '#FFFFFF';
  layer.lineWidth = style.mosaicBrushWidth;
  layer.lineCap = 'round';
  layer.lineJoin = 'round';
  for (const stroke of strokes) {
    traceStroke(layer, stroke.points);
    layer.stroke();
  }
  layer.globalCompositeOperation = 'source-in';
  layer.imageSmoothingEnabled = false;
  layer.drawImage(source, 0, 0, document.image.width, document.image.height);
  // `context` is already shifted by -region, so the layer lands at the origin.
  context.drawImage(layer.canvas, region.x, region.y);
}

function traceStroke(context: CanvasRenderingContext2D, points: readonly ImagePoint[]): void {
  const [first, ...rest] = points;
  if (first === undefined) {
    return;
  }
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of rest.length === 0 ? [first] : rest) {
    context.lineTo(point.x, point.y);
  }
}

export function drawAnnotationShapes(
  context: CanvasRenderingContext2D,
  shapes: readonly AnnotationShape[],
  style: AnnotationStyle,
): void {
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  context.lineWidth = style.strokeWidth;
  for (const shape of shapes) {
    switch (shape.kind) {
      case 'mosaic':
        break;
      case 'rect':
        context.strokeRect(shape.rect.x, shape.rect.y, shape.rect.width, shape.rect.height);
        break;
      case 'ellipse':
        context.beginPath();
        context.ellipse(
          shape.rect.x + shape.rect.width / 2,
          shape.rect.y + shape.rect.height / 2,
          shape.rect.width / 2,
          shape.rect.height / 2,
          0,
          0,
          Math.PI * 2,
        );
        context.stroke();
        break;
      case 'pen':
        traceStroke(context, shape.points);
        context.stroke();
        break;
      case 'arrow': {
        const { head, shaftEnd } = arrowGeometry(shape.from, shape.to, style.arrowHeadLength);
        context.beginPath();
        context.moveTo(shape.from.x, shape.from.y);
        context.lineTo(shaftEnd.x, shaftEnd.y);
        context.stroke();
        context.beginPath();
        context.moveTo(head[0].x, head[0].y);
        context.lineTo(head[1].x, head[1].y);
        context.lineTo(head[2].x, head[2].y);
        context.closePath();
        context.fill();
        break;
      }
      case 'text':
        context.save();
        context.font = `${ANNOTATION_FONT_WEIGHT} ${style.fontSize}px ${ANNOTATION_FONT_FAMILY}`;
        context.textBaseline = 'top';
        context.strokeStyle = '#FFFFFF';
        context.lineWidth = style.textHaloWidth * 2;
        context.strokeText(shape.text, shape.at.x, shape.at.y);
        context.fillText(shape.text, shape.at.x, shape.at.y);
        context.restore();
        break;
    }
  }
}
