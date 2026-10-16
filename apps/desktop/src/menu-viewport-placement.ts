/**
 * Fit a fixed-position menu opened at a pointer anchor inside the viewport.
 *
 * Menus open down-right of the anchor. When that would cross the bottom/right
 * edge the menu flips to open up/left of the anchor; if neither side fits it is
 * pinned against the edge so every item stays reachable.
 */
export type MenuPlacementInput = {
  anchor: { x: number; y: number };
  menuSize: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Minimum gap kept between the menu and the viewport edge. */
  margin?: number;
};

export const DEFAULT_MENU_VIEWPORT_MARGIN = 8;

function placeOnAxis(anchor: number, size: number, limit: number, margin: number): number {
  if (anchor + size <= limit - margin) {
    return anchor;
  }
  if (anchor - size >= margin) {
    return anchor - size;
  }
  return Math.max(margin, limit - margin - size);
}

export function placeMenuInViewport(input: MenuPlacementInput): { x: number; y: number } {
  const margin = input.margin ?? DEFAULT_MENU_VIEWPORT_MARGIN;
  return {
    x: placeOnAxis(input.anchor.x, input.menuSize.width, input.viewport.width, margin),
    y: placeOnAxis(input.anchor.y, input.menuSize.height, input.viewport.height, margin),
  };
}
