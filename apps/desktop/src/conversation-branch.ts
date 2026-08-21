/**
 * Pure helpers for the in-session conversation tree (ADR 0055).
 * The ‹n/m› switcher and optimistic clip both consume these — no Host I/O.
 */

import type { TranscriptBranchPoint } from '@piwin/contracts';

/** The switcher mounts on the active sibling head at a fork. */
export function findActiveBranchPoint(
  points: readonly TranscriptBranchPoint[],
  messageId: string,
): TranscriptBranchPoint | undefined {
  return points.find(
    (point) => point.siblings[point.activeIndex]?.headMessageId === messageId,
  );
}

/** Adjacent sibling head in sequence order; undefined at the edge. */
export function adjacentSiblingHead(
  point: TranscriptBranchPoint,
  delta: -1 | 1,
): string | undefined {
  return point.siblings[point.activeIndex + delta]?.headMessageId;
}

export function formatBranchSwitcherLabel(point: TranscriptBranchPoint): string {
  return `${point.activeIndex + 1}/${point.siblings.length}`;
}

/** Drop the target and everything after it. Null when the id is not in view. */
export function clipMessagesBeforeId<T extends { id: string }>(
  messages: readonly T[],
  messageId: string,
): T[] | null {
  const cut = messages.findIndex((message) => message.id === messageId);
  if (cut === -1) {
    return null;
  }
  return messages.slice(0, cut);
}
