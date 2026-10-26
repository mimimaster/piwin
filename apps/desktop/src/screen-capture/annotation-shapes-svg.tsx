/**
 * SVG view of annotation shapes and the crop mask, drawn in image pixels
 * inside an SVG whose viewBox is the image. Mirrors `drawAnnotationShapes`.
 */
import type { ReactElement } from 'react';
import { ANNOTATION_FONT_FAMILY, ANNOTATION_FONT_WEIGHT } from './annotation-export.js';
import {
  arrowGeometry,
  type AnnotationShape,
  type AnnotationStyle,
  type ImageRect,
  type ImageSize,
} from './annotation-model.js';

export function AnnotationShapesSvg({
  shapes,
  style,
}: {
  shapes: readonly AnnotationShape[];
  style: AnnotationStyle;
}): ReactElement {
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {shapes.map((shape) => {
        if (shape.kind === 'rect') {
          return (
            <rect
              key={shape.id}
              x={shape.rect.x}
              y={shape.rect.y}
              width={shape.rect.width}
              height={shape.rect.height}
              fill="none"
              stroke={style.color}
              strokeWidth={style.strokeWidth}
            />
          );
        }
        if (shape.kind === 'arrow') {
          const { head, shaftEnd } = arrowGeometry(shape.from, shape.to, style.arrowHeadLength);
          return (
            <g key={shape.id}>
              <line
                x1={shape.from.x}
                y1={shape.from.y}
                x2={shaftEnd.x}
                y2={shaftEnd.y}
                stroke={style.color}
                strokeWidth={style.strokeWidth}
              />
              <polygon
                points={head.map((point) => `${point.x},${point.y}`).join(' ')}
                fill={style.color}
              />
            </g>
          );
        }
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
      })}
    </g>
  );
}

/** Dims everything outside the crop and outlines it. */
export function CropMaskSvg({ crop, image }: { crop: ImageRect; image: ImageSize }): ReactElement {
  const outer = `M0 0H${image.width}V${image.height}H0Z`;
  const inner = `M${crop.x} ${crop.y}h${crop.width}v${crop.height}h${-crop.width}Z`;
  return (
    <g>
      <path d={`${outer}${inner}`} fill="rgba(0, 0, 0, 0.5)" fillRule="evenodd" />
      <rect
        x={crop.x}
        y={crop.y}
        width={crop.width}
        height={crop.height}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
