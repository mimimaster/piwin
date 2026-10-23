import type { ChatMessageUi } from './chat-ui-types';

type InstructionDelivery = NonNullable<ChatMessageUi['instructionDelivery']>;

/**
 * Which of two projections of one user row's delivery state is newer.
 *
 * Host revisions are monotonic per instruction, and a send-now conversion
 * only moves a row from `queued-turn` to `run-intervention`, never back.
 * Ties go to `incoming` so a Host page wins over an equal local copy.
 */
export function isInstructionDeliveryNewer(
  incoming: InstructionDelivery,
  current: InstructionDelivery,
): boolean {
  if (incoming.kind !== current.kind) return incoming.kind === 'run-intervention';
  if (incoming.instructionId !== current.instructionId) return true;
  return incoming.revision >= current.revision;
}

/**
 * Keep the live user row but adopt a Host page's delivery state when it is
 * newer. A lost `run/intervention-updated` push otherwise pins the card to
 * 「等待当前步骤完成」 after Host has already applied it.
 */
export function withNewerInstructionDelivery(
  live: ChatMessageUi,
  persisted: ChatMessageUi,
): ChatMessageUi {
  const incoming = persisted.instructionDelivery;
  if (incoming === undefined) return live;
  const current = live.instructionDelivery;
  if (current !== undefined && !isInstructionDeliveryNewer(incoming, current)) return live;
  if (
    current !== undefined &&
    current.kind === incoming.kind &&
    current.instructionId === incoming.instructionId &&
    current.revision === incoming.revision &&
    current.status === incoming.status
  ) {
    return live;
  }
  return {
    ...live,
    instructionDelivery: incoming,
    ...(persisted.runId !== undefined ? { runId: persisted.runId } : {}),
  };
}
