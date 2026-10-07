/**
 * Scene vs. document palette ownership.
 *
 * Theme repair assumes an artifact is a document resting on the host surface:
 * its page fill becomes transparent and its fixed colors follow the theme. A
 * self-painted scene (illustration, animation backdrop) breaks under that
 * assumption — text and overlays drawn for its own artwork get recolored for
 * a background they never sit on.
 */

const SVG_OPEN_TAG_PATTERN = /<svg\b[^>]*>/gi;
const COVER_ASPECT_PATTERN = /\bpreserveAspectRatio\s*=\s*(["'])[^"']*\bslice\b[^"']*\1/i;
const VIEW_BOX_PATTERN = /\bviewBox\s*=\s*["'][^"']+["']/i;

/**
 * True when the source declares a cover-fill SVG stage: a `viewBox` drawn with
 * `preserveAspectRatio="… slice"`. Only an author who paints the whole
 * viewport asks an SVG to crop itself to fill it, so the document owns its
 * palette and the host leaves its colors alone.
 */
export function paintsOwnScene(source: string): boolean {
  SVG_OPEN_TAG_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(SVG_OPEN_TAG_PATTERN)) {
    const tag = match[0];
    if (COVER_ASPECT_PATTERN.test(tag) && VIEW_BOX_PATTERN.test(tag)) {
      return true;
    }
  }
  return false;
}
