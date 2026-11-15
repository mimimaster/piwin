/**
 * Stage right-gutter auto-docking for the session status sheet.
 *
 * When the chat stage is wide enough for the conversation measure plus a
 * 296px gutter — and something is worth showing — the sheet pins itself to
 * the stage's right edge and the conversation re-centers. The user can
 * dismiss it; narrowing below the threshold and widening back past it resets
 * the dismissal so the sheet docks again on its own.
 *
 * Width is measured off the ResizeObserver entry's border-box (never
 * `clientWidth`: `.has-session-dock` adds `padding-right: 296px`, which would
 * shrink `clientWidth` the moment we dock and oscillate the layout).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  resolveConversationWidth,
  type ConversationWidth,
} from '../platform/ui-preferences.js';

/** Breathing room kept beside the measure before the gutter is allowed. */
export const SESSION_DOCK_MARGIN_PX = 56;
/** Width the docked sheet + its insets reserve on the stage's right edge. */
export const SESSION_DOCK_GUTTER_PX = 296;

const FALLBACK_CONVERSATION_PX = 720;

export function sessionDockThresholdPx(conversationWidth: ConversationWidth): number {
  const measure = Number.parseInt(resolveConversationWidth(conversationWidth), 10);
  const px = Number.isFinite(measure) && measure > 0 ? measure : FALLBACK_CONVERSATION_PX;
  return px + SESSION_DOCK_MARGIN_PX + SESSION_DOCK_GUTTER_PX;
}

export type UseSessionStageDockInput = {
  /** The `.chat-stage` element (border-box width drives the threshold). */
  stageRef: RefObject<HTMLDivElement | null>;
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
  const { stageRef, conversationWidth, hasAnyContent, suppressed } = input;
  const [stageWidth, setStageWidth] = useState(0);
  const [userDismissed, setUserDismissed] = useState(false);

  useEffect(() => {
    const element = stageRef.current;
    if (element === null) return;
    if (typeof ResizeObserver === 'undefined') {
      setStageWidth(element.getBoundingClientRect().width);
      return;
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
  }, [stageRef]);

  const canAutoDock = !suppressed && stageWidth >= sessionDockThresholdPx(conversationWidth);

  // Widening back over the threshold forgives the dismissal — the sheet was
  // asked away for a stage that no longer looks like this one.
  const previousCanAutoDock = useRef(canAutoDock);
  useEffect(() => {
    if (!previousCanAutoDock.current && canAutoDock) {
      setUserDismissed(false);
    }
    previousCanAutoDock.current = canAutoDock;
  }, [canAutoDock]);

  const isDocked = canAutoDock && !userDismissed && hasAnyContent;

  const dismiss = useCallback(() => setUserDismissed(true), []);
  const toggle = useCallback(() => setUserDismissed((dismissed) => !dismissed), []);

  return { canAutoDock, isDocked, userDismissed, dismiss, toggle };
}
