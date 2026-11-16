/**
 * Stage right-gutter auto-docking for the session status sheet.
 *
 * The conversation column stays centered in `.chat-stage` without shrinking or
 * pushing the stage left (`no padding-right`). When the stage widens enough
 * that the empty right gutter `(stageWidth - measure) / 2` can comfortably
 * fit the 272px floating sheet plus insets and clearance — and something is
 * worth showing — the sheet slots into that right gutter automatically.
 *
 * The user can dismiss it; narrowing a live stage below the width threshold
 * and widening back past it resets the dismissal so it docks again. Toggling
 * overlays (`suppressed`) or transient element remounts never resurrect a
 * dismissed sheet.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  resolveConversationWidth,
  type ConversationWidth,
} from '../platform/ui-preferences.js';

/** Width of `.session-status-dock` (matches `session-status.css`). */
export const SESSION_DOCK_PANEL_WIDTH_PX = 272;
/** Distance from `.session-status-dock` to the stage's right border. */
export const SESSION_DOCK_RIGHT_INSET_PX = 12;
/** Minimum breathing room kept between the centered conversation and the dock. */
export const SESSION_DOCK_GAP_PX = 16;
/** Total right-gutter space required to seat the dock beside centered text. */
export const SESSION_DOCK_GUTTER_PX =
  SESSION_DOCK_PANEL_WIDTH_PX + SESSION_DOCK_RIGHT_INSET_PX + SESSION_DOCK_GAP_PX;

const FALLBACK_CONVERSATION_PX = 720;

export function sessionDockThresholdPx(conversationWidth: ConversationWidth): number {
  const measure = Number.parseInt(resolveConversationWidth(conversationWidth), 10);
  const px = Number.isFinite(measure) && measure > 0 ? measure : FALLBACK_CONVERSATION_PX;
  // Centered measure leaves `(stageWidth - measure) / 2` on each side.
  return px + 2 * SESSION_DOCK_GUTTER_PX;
}

export type UseSessionStageDockInput = {
  /** Optional ref fallback; prefer wiring the returned `stageRef` callback to `.chat-stage`. */
  stageRef?: RefObject<HTMLDivElement | null> | undefined;
  conversationWidth: ConversationWidth;
  /** Running rows, deliverables or context — anything worth a gutter. */
  hasAnyContent: boolean;
  /**
   * Stage is covered or its width is spoken for: right panel, studio,
   * settings, a sub-page, phone/compact layouts, the CLI override, or a
   * column inspector resized to full width.
   */
  suppressed: boolean;
};

export type SessionStageDock = {
  /** Callback ref to pass to `.chat-stage` so remounts re-attach ResizeObserver. */
  stageRef: (node: HTMLDivElement | null) => void;
  /** The stage can host the gutter right now (threshold met, not suppressed). */
  canAutoDock: boolean;
  /** The sheet is actually docked: allowed, not dismissed, has content. */
  isDocked: boolean;
  /** User asked the sheet away while it could have docked. */
  userDismissed: boolean;
  dismiss: () => void;
  toggle: () => void;
};

export function useSessionStageDock(input: UseSessionStageDockInput): SessionStageDock {
  const { stageRef: externalRef, conversationWidth, hasAnyContent, suppressed } = input;
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(
    () => externalRef?.current ?? null,
  );
  const [stageWidth, setStageWidth] = useState(0);
  const [userDismissed, setUserDismissed] = useState(false);

  const stageRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (externalRef) {
        externalRef.current = node;
      }
      setStageElement(node);
    },
    [externalRef],
  );

  useEffect(() => {
    if (externalRef && externalRef.current !== stageElement) {
      setStageElement(externalRef.current);
    }
  }, [externalRef, stageElement]);

  useEffect(() => {
    const element = stageElement ?? externalRef?.current ?? null;
    if (element === null) {
      setStageWidth(0);
      return;
    }
    const readWidth = (): number => element.getBoundingClientRect().width;
    if (typeof ResizeObserver === 'undefined') {
      setStageWidth(readWidth());
      return;
    }
    const initialWidth = readWidth();
    if (initialWidth > 0) {
      setStageWidth(initialWidth);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const borderBox = entry.borderBoxSize;
      const first = Array.isArray(borderBox) ? borderBox[0] : borderBox;
      setStageWidth(first?.inlineSize ?? entry.target.getBoundingClientRect().width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [stageElement, externalRef]);

  const fitsWidth = stageWidth >= sessionDockThresholdPx(conversationWidth);
  const canAutoDock = !suppressed && fitsWidth;

  // Narrowing a live stage below the threshold and widening back past it
  // forgives the dismissal. Toggling `suppressed` (settings, inspector) or
  // transient `0`-width unmounts must not revive a dismissed sheet.
  const previousFitsWidth = useRef(fitsWidth);
  useEffect(() => {
    if (stageWidth <= 0) return;
    if (!previousFitsWidth.current && fitsWidth) {
      setUserDismissed(false);
    }
    previousFitsWidth.current = fitsWidth;
  }, [fitsWidth, stageWidth]);

  const isDocked = canAutoDock && !userDismissed && hasAnyContent;

  const dismiss = useCallback(() => setUserDismissed(true), []);
  const toggle = useCallback(() => setUserDismissed((dismissed) => !dismissed), []);

  return { stageRef, canAutoDock, isDocked, userDismissed, dismiss, toggle };
}
