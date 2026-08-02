/**
 * Resolve on-screen pet sprite size from atlas cell geometry.
 *
 * Codex standard cells are 192×208 and render at three-eighths scale (72×78).
 * Smaller bundled pets (e.g. 48×52) scale up so they land near the same
 * visual height while preserving the cell aspect ratio — no fixed square box.
 */

/** Target CSS height for a standard Codex cell (192×208 → 72×78). */
export const PET_TARGET_DISPLAY_HEIGHT_PX = 78;

/** Preferred pixel-art scales (crisp when the atlas divides evenly). */
const PREFERRED_SCALES = [0.5, 1, 1.5, 2, 3, 4] as const;

export type PetDisplaySize = {
  width: number;
  height: number;
  scale: number;
};

/**
 * Map cellWidth×cellHeight → CSS display size, preserving aspect ratio.
 * Prefers half/integer scales when close to the target height so pixel art
 * stays sharp.
 */
export function resolvePetDisplaySize(cellWidth: number, cellHeight: number): PetDisplaySize {
  const safeW = Math.max(1, Math.round(cellWidth));
  const safeH = Math.max(1, Math.round(cellHeight));
  const rawScale = PET_TARGET_DISPLAY_HEIGHT_PX / safeH;

  let scale = rawScale;
  for (const candidate of PREFERRED_SCALES) {
    if (Math.abs(candidate - rawScale) <= 0.08) {
      scale = candidate;
      break;
    }
  }

  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
    scale,
  };
}

/** Max bubble width — Codex reports ~276px for longer status text. */
export const PET_BUBBLE_MAX_WIDTH_PX = 276;

/** Vertical room reserved above the sprite for the speech bubble + tail. */
export const PET_BUBBLE_RESERVE_HEIGHT_PX = 108;

/** Horizontal / vertical padding inside the overlay window. */
export const PET_OVERLAY_PAD_X_PX = 12;
export const PET_OVERLAY_PAD_Y_PX = 8;

export type PetOverlayWindowSize = {
  width: number;
  height: number;
};

/**
 * Tight overlay window size for the current sprite (+ optional bubble band).
 * Width expands to fit the bubble when active so long tool paths are readable.
 */
export function resolvePetOverlayWindowSize(
  display: PetDisplaySize,
  hasBubble: boolean,
): PetOverlayWindowSize {
  const contentW = hasBubble ? Math.max(display.width, PET_BUBBLE_MAX_WIDTH_PX) : display.width;
  const contentH = display.height + (hasBubble ? PET_BUBBLE_RESERVE_HEIGHT_PX : 0);
  return {
    width: contentW + PET_OVERLAY_PAD_X_PX * 2,
    height: contentH + PET_OVERLAY_PAD_Y_PX * 2,
  };
}
