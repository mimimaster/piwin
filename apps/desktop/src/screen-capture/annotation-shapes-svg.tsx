/**
 * SVG view of the capture editor, drawn in image pixels inside an SVG whose
 * viewBox is the image. Marks mirror `drawAnnotationShapes`; the region
 * layer dims everything outside the selection like QQ.
 */
import { useId, type ReactElement } from 'react';
import { ANNOTATION_FONT_FAMILY, ANNOTATION_FONT_WEIGHT } from './annotation-export.js';
import {
  arrowGeometry,
  strokePath,
  type AnnotationShape,
  type AnnotationStyle,
  type ImageRect,
  type ImageSize,
} from './annotation-model.js';
import { handlePoint, SELECTION_HANDLES } from './selection-geometry.js';

/** Region border and handles; red stays reserved for the user's own marks. */
export const SELECTION_COLOR = '#2B8CFF';

export function AnnotationShapesSvg({
  shapes,
  style,
}: {
  shapes: readonly AnnotationShape[];
  style: AnnotationStyle;
}): ReactElement {
  return (
    <g
      strokeLinejoin="round"
      strokeLinecap="round"
      stroke={style.color}
      strokeWidth={style.strokeWidth}
      fill="none"
    >
      {shapes.map((shape) => {
        switch (shape.kind) {
          case 'mosaic':
            return null;
          case 'rect':
            return (
              <rect
                key={shape.id}
                x={shape.rect.x}
                y={shape.rect.y}
                width={shape.rect.width}
                height={shape.rect.height}
              />
            );
          case 'ellipse':
            return (
              <ellipse
                key={shape.id}
                cx={shape.rect.x + shape.rect.width / 2}
                cy={shape.rect.y + shape.rect.height / 2}
                rx={shape.rect.width / 2}
                ry={shape.rect.height / 2}
              />
            );
          case 'pen':
            return <path key={shape.id} d={strokePath(shape.points)} />;
          case 'arrow': {
            const { head, shaftEnd } = arrowGeometry(shape.from, shape.to, style.arrowHeadLength);
            return (
              <g key={shape.id}>
                <line x1={shape.from.x} y1={shape.from.y} x2={shaftEnd.x} y2={shaftEnd.y} />
                <polygon
                  points={head.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill={style.color}
                  stroke="none"
                />
              </g>
            );
          }
          case 'text':
            return (
              <text
                key={shape.id}
                x={shape.at.x}
                y={shape.at.y}
                dominantBaseline="text-before-edge"
                fontFamily={ANNOTATION_FONT_FAMILY}
                fontWeight={ANNOTATION_FONT_WEIGHT}
                fontSize={style.fontSize}
                fill={style.color}
                stroke="#FFFFFF"
                strokeWidth={style.textHaloWidth * 2}
                paintOrder="stroke"
              >
                {shape.text}
              </text>
            );
        }
      })}
    </g>
  );
}

/** Pixelated copy of the screenshot, shown only where mosaic strokes are. */
export function MosaicLayerSvg({
  shapes,
  image,
  sourceUrl,
  style,
}: {
  shapes: readonly AnnotationShape[];
  image: ImageSize;
  /** Pre-pixelated copy of the whole screenshot (see `createMosaicPreview`). */
  sourceUrl: string | null;
  style: AnnotationStyle;
}): ReactElement | null {
  const maskId = useId();
  const strokes = shapes.filter((shape) => shape.kind === 'mosaic');
  if (sourceUrl === null || strokes.length === 0) {
    return null;
  }
  return (
    <g>
      <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={image.width} height={image.height}>
        <g
          stroke="#FFFFFF"
          strokeWidth={style.mosaicBrushWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          {strokes.map((stroke) => (
            <path key={stroke.id} d={strokePath(stroke.points)} />
          ))}
        </g>
      </mask>
      <image
        href={sourceUrl}
        x={0}
        y={0}
        width={image.width}
        height={image.height}
        preserveAspectRatio="none"
        mask={`url(#${maskId})`}
      />
    </g>
  );
}

/**
 * Dims outside the region (everything before one exists), outlines it and,
 * while it can still be adjusted, shows the eight handles. `viewScale`
 * keeps handles a constant size on screen.
 */
export function SelectionLayerSvg({
  selection,
  image,
  viewScale,
  showHandles,
}: {
  selection: ImageRect | null;
  image: ImageSize;
  viewScale: number;
  showHandles: boolean;
}): ReactElement {
  const outer = `M0 0H${image.width}V${image.height}H0Z`;
  if (selection === null) {
    return <path className="screen-capture-dim" d={outer} />;
  }
  const inner = `M${selection.x} ${selection.y}h${selection.width}v${selection.height}h${-selection.width}Z`;
  const handleSize = 7 / viewScale;
  return (
    <g>
      <path className="screen-capture-dim" d={`${outer}${inner}`} fillRule="evenodd" />
      <rect
        x={selection.x}
        y={selection.y}
        width={selection.width}
        height={selection.height}
        fill="none"
        stroke={SELECTION_COLOR}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      {showHandles
        ? SELECTION_HANDLES.map((handle) => {
            const center = handlePoint(selection, handle);
            return (
              <rect
                key={handle}
                data-handle={handle}
                x={center.x - handleSize / 2}
                y={center.y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                fill="#FFFFFF"
                stroke={SELECTION_COLOR}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })
        : null}
    </g>
  );
}
