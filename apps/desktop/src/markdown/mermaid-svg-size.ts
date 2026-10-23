/**
 * Gives a Mermaid SVG the intrinsic size of its own drawing.
 *
 * Mermaid emits `width="100%"` and carries the drawing's real width only as an
 * inline `max-width`. The transcript has to override that inline cap so a wide
 * diagram can shrink to the column, and what is left is an SVG with an aspect
 * ratio but no width — which a browser lays out at the full column width. A
 * narrow eight-node flowchart then renders at twice its size and a screen and
 * a half tall. With the viewBox written back as `width`/`height`, the
 * stylesheet's `width: auto; max-width: 100%; height: auto` shows the diagram
 * at its drawn size and only ever scales it down.
 */
export function withIntrinsicMermaidSvgSize(svg: string): string {
  const openTag = /^\s*<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!openTag) {
    return svg;
  }
  const viewBox = /\bviewBox\s*=\s*"([^"]+)"/i.exec(openTag)?.[1];
  const parts = viewBox?.trim().split(/[\s,]+/).map(Number) ?? [];
  const width = parts[2];
  const height = parts[3];
  if (
    parts.length !== 4 ||
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return svg;
  }
  const sized = openTag
    .replace(/\s(?:width|height)\s*=\s*"[^"]*"/gi, '')
    .replace(/^(\s*<svg\b)/i, `$1 width="${Math.ceil(width)}" height="${Math.ceil(height)}"`);
  return sized + svg.slice(openTag.length);
}
