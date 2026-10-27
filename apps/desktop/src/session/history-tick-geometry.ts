/**
 * Collapsed history rail geometry: tick pitch, the hover wave profile, and
 * pointer/bubble placement. Pure math so the rail never measures every tick
 * on every mouse event.
 */
import type { CSSProperties } from 'react';

// Keep these geometry values in sync with the compact rail CSS variables
// (--history-tick-gap / --history-tick-pad-y). They let the pointer map to a
// tick without measuring every tick on every mouse event.
export const COLLAPSED_TICK_HEIGHT_PX = 1;
export const COLLAPSED_TICK_GAP_PX = 10;
export const COLLAPSED_TICK_PADDING_TOP_PX = 8;
export const COLLAPSED_TICK_STEP_PX = COLLAPSED_TICK_HEIGHT_PX + COLLAPSED_TICK_GAP_PX;

// Hover wave profile, peak first. Widths fall off on an ease-out curve (not
// a straight ramp) so the wave reads as one soft lens; opacity fades toward
// the resting tone in CSS; the peak and first shoulders gain a little weight
// so the selected turn is clearly picked without any extra mark. Keep the
// base width in sync with the compact rail CSS.
const COLLAPSED_TICK_BASE_WIDTH_PX = 8;
const HISTORY_TICK_WAVE_MAX_WIDTH_PX = 24;
const HISTORY_TICK_WAVE_PROFILE = [
  { widthPx: HISTORY_TICK_WAVE_MAX_WIDTH_PX, opacity: 0.75, thicknessPx: 2 },
  { widthPx: 17, opacity: 0.4, thicknessPx: 1.5 },
  { widthPx: 12.5, opacity: 0.25, thicknessPx: 1.5 },
  { widthPx: 9.5, opacity: 0.17, thicknessPx: 1 },
] as const;

type HistoryTickWaveStep = (typeof HISTORY_TICK_WAVE_PROFILE)[number];

function getHistoryTickWaveStep(distance: number): HistoryTickWaveStep | null {
  if (!Number.isFinite(distance)) {
    return null;
  }
  return HISTORY_TICK_WAVE_PROFILE[Math.round(Math.abs(distance))] ?? null;
}

/** Returns the horizontal scale for a collapsed tick at a wave distance. */
export function getHistoryTickWaveScale(distance: number): number {
  const step = getHistoryTickWaveStep(distance);
  return step ? step.widthPx / COLLAPSED_TICK_BASE_WIDTH_PX : 1;
}

/** Inline wave style for a tick, or undefined when it rests (CSS styles it). */
export function getHistoryTickWaveStyle(distance: number | null): CSSProperties | undefined {
  const step = distance === null ? null : getHistoryTickWaveStep(distance);
  if (!step) {
    return undefined;
  }
  const style: CSSProperties = {
    transform: `scaleX(${step.widthPx / COLLAPSED_TICK_BASE_WIDTH_PX})`,
    opacity: step.opacity,
  };
  if (step.thicknessPx !== COLLAPSED_TICK_HEIGHT_PX) {
    // Negative block margins keep the extra weight out of layout, so the
    // column (and the pointer→tick mapping) never shifts.
    style.height = `${step.thicknessPx}px`;
    style.marginBlock = `${(COLLAPSED_TICK_HEIGHT_PX - step.thicknessPx) / 2}px`;
  }
  return style;
}

export type CollapsedBubbleAnchor = {
  /** Viewport X of the bubble's right edge; the bubble opens leftward. */
  edgeX: number;
  top: number;
};

export type CollapsedRailMetrics = {
  rail: HTMLDivElement;
  top: number;
  bubbleEdgeX: number;
  tickCount: number;
};

/** Gap between the peak wave tip and the preview bubble. Keep small so the
 *  tooltip reads as attached to the tick rail rather than floating mid-stage. */
const COLLAPSED_BUBBLE_OFFSET_PX = 8;
const COLLAPSED_BUBBLE_MAX_HALF_HEIGHT_PX = 120;
const COLLAPSED_BUBBLE_VIEWPORT_PADDING_PX = 12;

export function clampCollapsedBubbleTop(centerY: number): number {
  const viewportHeight = window.innerHeight || 768;
  const minTop = COLLAPSED_BUBBLE_VIEWPORT_PADDING_PX + COLLAPSED_BUBBLE_MAX_HALF_HEIGHT_PX;
  const maxTop = Math.max(
    minTop,
    viewportHeight - COLLAPSED_BUBBLE_VIEWPORT_PADDING_PX - COLLAPSED_BUBBLE_MAX_HALF_HEIGHT_PX,
  );
  return Math.min(Math.max(centerY, minTop), maxTop);
}

/** Viewport X just short of the peak wave tip for a right-edge rail. Ticks
 *  are right-aligned in the strip, so the tip sits at railRight - max width. */
export function getBubbleEdgeXFromRailRight(railRight: number): number {
  return railRight - HISTORY_TICK_WAVE_MAX_WIDTH_PX - COLLAPSED_BUBBLE_OFFSET_PX;
}

export function getCollapsedBubbleAnchor(element: HTMLElement): CollapsedBubbleAnchor {
  const bounds = element.getBoundingClientRect();
  return {
    // Focus path measures the tick itself; use its painted left edge so a
    // scaled wave tip is the anchor rather than the full reserved strip.
    edgeX: bounds.left - COLLAPSED_BUBBLE_OFFSET_PX,
    top: clampCollapsedBubbleTop(bounds.top + bounds.height / 2),
  };
}

/**
 * Map a pointer Y on the collapsed rail to the nearest tick index.
 * Shared by hover preview and click-to-jump so gaps between 1px ticks still
 * resolve to a message (hover already did; click must match).
 */
export function resolveCollapsedTickIndex(options: {
  clientY: number;
  railTop: number;
  railScrollTop: number;
  tickCount: number;
}): number | null {
  if (options.tickCount <= 0) {
    return null;
  }

  const localY =
    options.clientY - options.railTop + options.railScrollTop - COLLAPSED_TICK_PADDING_TOP_PX;
  const rawPosition = (localY - COLLAPSED_TICK_HEIGHT_PX / 2) / COLLAPSED_TICK_STEP_PX;
  const pointerPosition = Math.min(Math.max(rawPosition, 0), options.tickCount - 1);
  return Math.round(pointerPosition);
}
