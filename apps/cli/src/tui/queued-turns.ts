import type { SelectItem } from '@earendil-works/pi-tui';
import type { PromptInput, QueuedTurnRecord } from '@piwin/contracts';
import { isQueuedTurnPending } from '@piwin/contracts';

/**
 * The Host's next-turn queue for one session, as the TUI shows it. Pure —
 * tui-queue-controller talks to the Host.
 */

const PREVIEW_CHARS = 60;

/** Fold one record into the pending list: terminal records leave it. */
export function applyQueuedTurn(
  pending: readonly QueuedTurnRecord[],
  record: QueuedTurnRecord,
): QueuedTurnRecord[] {
  const others = pending.filter((turn) => turn.queuedTurnId !== record.queuedTurnId);
  const existing = pending.find((turn) => turn.queuedTurnId === record.queuedTurnId);
  // Pushes can arrive out of order; an older revision must not undo a newer one.
  if (existing !== undefined && existing.revision > record.revision) return [...pending];
  const next = isQueuedTurnPending(record.status) ? [...others, record] : others;
  return next.sort((left, right) => left.sequence - right.sequence);
}

export function pendingQueuedTurns(records: readonly QueuedTurnRecord[]): QueuedTurnRecord[] {
  return records.filter((record) => isQueuedTurnPending(record.status)).sort((left, right) => left.sequence - right.sequence);
}

export function describeQueue(pending: readonly QueuedTurnRecord[]): string | undefined {
  return pending.length === 0 ? undefined : `排队 ${pending.length}`;
}

/** What a queued or just-started turn carried besides its text. */
export function describePromptExtras(input: PromptInput): string[] {
  return [
    ...(input.contextRefs ?? []).flatMap((ref) =>
      ref.kind === 'file' || ref.kind === 'folder' ? [`@${ref.label}${ref.kind === 'folder' ? '/' : ''}`] : [],
    ),
    ...(input.attachments ?? []).map((attachment) =>
      attachment.kind === 'media' ? `附件 ${attachment.name ?? attachment.id}` : '附件',
    ),
  ];
}

export type QueueMove = 'up' | 'down' | 'top';

/** The queue's ids with one turn moved; undefined when it is already there. */
export function moveQueuedTurn(
  pending: readonly QueuedTurnRecord[],
  queuedTurnId: string,
  move: QueueMove,
): string[] | undefined {
  const ids = pending.map((turn) => turn.queuedTurnId);
  const from = ids.indexOf(queuedTurnId);
  if (from === -1) return undefined;
  const to = move === 'top' ? 0 : move === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length || to === from) return undefined;
  ids.splice(from, 1);
  ids.splice(to, 0, queuedTurnId);
  return ids;
}

export function queuedTurnItems(pending: readonly QueuedTurnRecord[]): SelectItem[] {
  return pending.map((turn, index) => {
    const text = turn.input.text.replace(/\s+/g, ' ').trim();
    const preview = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
    const extras = describePromptExtras(turn.input);
    return {
      value: turn.queuedTurnId,
      label: `${index + 1}. ${preview.length === 0 ? '（无文字）' : preview}`,
      ...(extras.length === 0 ? {} : { description: extras.join(' ') }),
    };
  });
}
