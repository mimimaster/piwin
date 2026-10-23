/**
 * Pure helpers for the in-session conversation tree (ADR 0055 / 0064).
 * The ‹n/m› switcher and optimistic clip both consume these — no Host I/O.
 */

import {
  isPromptForkPoint,
  type PromptContextRef,
  type TranscriptBranchPoint,
} from '@piwin/contracts';

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
  return `${point.activeIndex + 1} / ${point.siblings.length}`;
}

/** Extra prompt-edit siblings. Answer versions and Fork Chat sessions are not counted. */
export function countConversationTreeBranches(
  points: readonly TranscriptBranchPoint[],
): number {
  return points
    .filter(isPromptForkPoint)
    .reduce((sum, point) => sum + Math.max(0, point.siblings.length - 1), 0);
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

/** Keep the target, drop everything after it. Null when the id is not in view. */
export function clipMessagesAfterId<T extends { id: string }>(
  messages: readonly T[],
  messageId: string,
): T[] | null {
  const cut = messages.findIndex((message) => message.id === messageId);
  if (cut === -1) {
    return null;
  }
  return messages.slice(0, cut + 1);
}

export function attachmentsEqual(
  left: readonly { id: string }[],
  right: readonly { id: string }[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item.id === right[index]?.id);
}

export function contextRefsEqual(
  left: readonly PromptContextRef[],
  right: readonly PromptContextRef[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => JSON.stringify(item) === JSON.stringify(right[index]));
}

/** Unchanged text + attachments + refs is a retry, not a prompt fork. */
export function turnContentUnchanged(
  original: {
    text: string;
    attachments: readonly { id: string }[];
    contextRefs?: readonly PromptContextRef[];
  },
  next: {
    text: string;
    attachments?: readonly { id: string }[];
    contextRefs?: readonly PromptContextRef[];
  },
): boolean {
  return (
    original.text.trim() === next.text.trim() &&
    attachmentsEqual(original.attachments, next.attachments ?? original.attachments) &&
    contextRefsEqual(original.contextRefs ?? [], next.contextRefs ?? original.contextRefs ?? [])
  );
}

/**
 * Edit-resend is a retry only for the current user turn. An older unchanged
 * send would truncate the rest of the conversation; that is Revert, not Repair.
 */
export function isUnchangedCurrentTurnResend(
  messages: readonly {
    id: string;
    role: string;
    text: string;
    attachments: readonly { id: string }[];
    contextRefs?: readonly PromptContextRef[];
  }[],
  messageId: string,
  next: {
    text: string;
    attachments?: readonly { id: string }[];
    contextRefs?: readonly PromptContextRef[];
  },
): boolean {
  const original = messages.find((message) => message.id === messageId);
  if (original === undefined || original.role !== 'user') {
    return false;
  }
  if (!turnContentUnchanged(original, next)) {
    return false;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return messages[index]?.id === messageId;
    }
  }
  return false;
}
