/**
 * Rasterize an annotated screenshot to PNG at full image resolution
 * (spec 2026-10-25 §6.4). The editor view is scaled; this never is.
 */
import {
  annotationStyle,
  arrowGeometry,
  exportRegion,
  type AnnotationDocument,
  type AnnotationShape,
  type AnnotationStyle,
} from './annotation-model.js';

/** Shared with the SVG view so on-screen text matches the exported text. */
export const ANNOTATION_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
export const ANNOTATION_FONT_WEIGHT = 600;

export class AnnotationExportError extends Error {
  override readonly name = 'AnnotationExportError';
}

export async function exportAnnotatedPng(
  image: CanvasImageSource,
  document: AnnotationDocument,
): Promise<Blob> {
  const region = exportRegion(document);
  const canvas = window.document.createElement('canvas');
  canvas.width = region.width;
  canvas.height = region.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new AnnotationExportError('Canvas 2D context is unavailable');
  }
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
  drawAnnotationShapes(context, document.shapes, annotationStyle(document.image));
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

export function drawAnnotationShapes(
  context: CanvasRenderingContext2D,
  shapes: readonly AnnotationShape[],
  style: AnnotationStyle,
): void {
  context.lineJoin = 'round';
  context.lineCap = 'round';
  for (const shape of shapes) {
    if (shape.kind === 'rect') {
      context.strokeStyle = style.color;
      context.lineWidth = style.strokeWidth;
      context.strokeRect(shape.rect.x, shape.rect.y, shape.rect.width, shape.rect.height);
      continue;
    }
    if (shape.kind === 'arrow') {
      const { head, shaftEnd } = arrowGeometry(shape.from, shape.to, style.arrowHeadLength);
      context.strokeStyle = style.color;
      context.lineWidth = style.strokeWidth;
      context.beginPath();
      context.moveTo(shape.from.x, shape.from.y);
      context.lineTo(shaftEnd.x, shaftEnd.y);
      context.stroke();
      context.fillStyle = style.color;
      context.beginPath();
      context.moveTo(head[0].x, head[0].y);
      context.lineTo(head[1].x, head[1].y);
      context.lineTo(head[2].x, head[2].y);
      context.closePath();
      context.fill();
      continue;
    }
    context.font = `${ANNOTATION_FONT_WEIGHT} ${style.fontSize}px ${ANNOTATION_FONT_FAMILY}`;
    context.textBaseline = 'top';
    context.strokeStyle = '#FFFFFF';
    context.lineWidth = style.textHaloWidth * 2;
    context.strokeText(shape.text, shape.at.x, shape.at.y);
    context.fillStyle = style.color;
    context.fillText(shape.text, shape.at.x, shape.at.y);
  }
}
