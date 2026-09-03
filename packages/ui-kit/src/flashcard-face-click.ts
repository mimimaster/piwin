/**
 * Whole-card click-to-flip policy (2026-09-03 spec §3).
 *
 * A "flip click" is a pointer press and release on the card that:
 *   - moved less than FLIP_CLICK_MAX_DISTANCE_PX between press and release,
 *   - did not start on top of an existing text selection inside the card
 *     (the press that clears a selection must not also flip),
 *   - did not end with a non-collapsed text selection inside the card
 *     (a drag-select never flips),
 *   - did not target an interactive element (link, button, form control,
 *     contenteditable) whose own activation must win.
 *
 * Pure: no DOM access here so the policy is unit-testable; callers feed facts.
 */

export const FLIP_CLICK_MAX_DISTANCE_PX = 6;

export type FlipClickFacts = {
  /** Distance in CSS px between pointerdown and click. */
  pointerTravelPx: number;
  /** A non-collapsed selection existed inside the card when the press began. */
  selectionExistedOnPress: boolean;
  /** A non-collapsed selection exists inside the card when the click fires. */
  selectionExistsOnClick: boolean;
  /** The click target (or an ancestor within the card) is interactive. */
  targetIsInteractive: boolean;
};

export function shouldFlipOnClick(facts: FlipClickFacts): boolean {
  if (facts.targetIsInteractive) return false;
  if (facts.selectionExistedOnPress) return false;
  if (facts.selectionExistsOnClick) return false;
  return facts.pointerTravelPx <= FLIP_CLICK_MAX_DISTANCE_PX;
}

const INTERACTIVE_SELECTOR = 'a[href], button, input, textarea, select, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"]';

/** True when the click target sits on an interactive element inside `card`. */
export function isInteractiveClickTarget(target: EventTarget | null, card: Element): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return interactive !== null && card.contains(interactive);
}

/** True when the document has a non-collapsed selection that intersects `card`. */
export function hasSelectionInside(card: Element): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (range.collapsed) continue;
    if (card.contains(range.commonAncestorContainer)) return true;
    if (typeof range.intersectsNode === 'function' && range.intersectsNode(card)) return true;
  }
  return false;
}