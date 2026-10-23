/**
 * Minimum reading area owned by the newest response turn.
 *
 * Matching mature agent chat surfaces, the active/latest turn occupies most
 * of the transcript viewport even before its content is tall. The response
 * can therefore grow down to a stable output floor; after that point normal
 * follow-tail scrolling pushes older content upward.
 */

/** VS Code Chat uses the same 75% current-response viewport proportion. */
export const CURRENT_RESPONSE_VIEWPORT_RATIO = 0.75;

/** Convert the live scrollport height into the newest turn's minimum height. */
export function computeCurrentResponseMinHeight(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return 0;
  }
  return Math.round(viewportHeight * CURRENT_RESPONSE_VIEWPORT_RATIO);
}
