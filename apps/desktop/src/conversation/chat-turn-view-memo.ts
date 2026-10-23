import type { ChatThreadProps } from './chat-thread-types.js';
import type { ChatTurnRenderInput } from './chat-turn-renderer.js';
import { exploreFlowRolesEqual } from './explore-flow.js';
import type { TranscriptTurn } from './transcript-turns.js';

function areListsEqual<Item>(
  left: readonly Item[] | undefined,
  right: readonly Item[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function turnContainsMessage(turn: TranscriptTurn, messageId: string | null): boolean {
  return messageId !== null && turn.items.some((item) => item.message.id === messageId);
}

/**
 * Run records a settled turn can read: its messages' runs and its tools' runs
 * (a plan card is owned by the run of the tool that presented it). The reducer
 * replaces only the record of the run that moved, so the rest keep identity.
 */
function areTurnRunRecordsEqual(
  turn: TranscriptTurn,
  previous: ChatThreadProps['runRecordsById'],
  next: ChatThreadProps['runRecordsById'],
): boolean {
  if (previous === next) return true;
  for (const item of turn.items) {
    const runId = item.message.runId;
    if (runId !== undefined && previous?.[runId] !== next?.[runId]) return false;
    for (const tool of item.message.tools) {
      if (tool.runId !== undefined && previous?.[tool.runId] !== next?.[tool.runId]) return false;
    }
  }
  return true;
}

/**
 * Thread props as one turn sees them. Every key is compared by identity unless
 * it is listed here with the narrower thing a turn actually reads — a prop
 * added to ChatThread later is therefore compared, never silently ignored.
 */
function areThreadPropsEqualForTurn(
  turn: TranscriptTurn,
  previous: ChatThreadProps,
  next: ChatThreadProps,
  isCurrentResponseTurn: boolean,
): boolean {
  if (previous === next) return true;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]) as Set<
    keyof ChatThreadProps
  >;
  for (const key of keys) {
    if (key === 'messages') {
      // The turn's own rows arrive through `turn`; nothing in a turn reads the
      // rest of the transcript.
      continue;
    }
    if (key === 'runRecordsById') {
      // The live turn's footer follows the active run before any row carries
      // its id, so it takes the table as a whole.
      if (isCurrentResponseTurn) {
        if (previous.runRecordsById !== next.runRecordsById) return false;
      } else if (!areTurnRunRecordsEqual(turn, previous.runRecordsById, next.runRecordsById)) {
        return false;
      }
      continue;
    }
    if (key === 'composerCard') {
      // The card itself only mounts inside the row being edited.
      if (previous.composerCard.activeAgentId !== next.composerCard.activeAgentId) return false;
      const editsThisTurn =
        turnContainsMessage(turn, previous.editingMessageId) ||
        turnContainsMessage(turn, next.editingMessageId);
      if (editsThisTurn && previous.composerCard !== next.composerCard) return false;
      continue;
    }
    if (!Object.is(previous[key], next[key])) return false;
  }
  return true;
}

/**
 * Whether a turn would render the same output. ChatThread re-renders on every
 * token with fresh session-wide maps (explore roles, entering ids, changed
 * files, workflows); each is narrowed here to the entries of this turn so a
 * settled turn skips its whole projection — work fold, segment plan, row props.
 */
export function areChatTurnRenderInputsEqual(
  previous: ChatTurnRenderInput,
  next: ChatTurnRenderInput,
): boolean {
  const turn = next.turn;
  if (previous.turn !== turn) return false;
  const wasCurrent = turn.id === previous.currentResponseTurnId;
  const isCurrent = turn.id === next.currentResponseTurnId;
  if (wasCurrent !== isCurrent) return false;
  if (
    (turn.id === previous.compactionActivityTurnId) !==
    (turn.id === next.compactionActivityTurnId)
  ) {
    return false;
  }
  // The newest assistant message is always the last assistant of its turn.
  if (
    (turn.lastAssistantMessageId === previous.latestAssistantMessageId) !==
    (turn.lastAssistantMessageId === next.latestAssistantMessageId)
  ) {
    return false;
  }
  if (
    previous.conversationSession !== next.conversationSession ||
    previous.precedingUser !== next.precedingUser ||
    previous.workflowError !== next.workflowError ||
    previous.setWorkDisclosureOpenByTurnId !== next.setWorkDisclosureOpenByTurnId ||
    previous.segmentState.openOverrides !== next.segmentState.openOverrides ||
    previous.segmentState.windowSizeFor !== next.segmentState.windowSizeFor ||
    previous.segmentState.toggleSegment !== next.segmentState.toggleSegment ||
    previous.segmentState.showEarlier !== next.segmentState.showEarlier ||
    !areListsEqual(previous.workflows, next.workflows)
  ) {
    return false;
  }
  const disclosureKey = `${next.props.sessionId ?? 'session'}:${turn.id}`;
  if (
    previous.workDisclosureOpenByTurnId[disclosureKey] !==
    next.workDisclosureOpenByTurnId[disclosureKey]
  ) {
    return false;
  }
  if (
    !areListsEqual(
      previous.changedFilePathsByTurnId.get(turn.id),
      next.changedFilePathsByTurnId.get(turn.id),
    )
  ) {
    return false;
  }
  const previousCaret = turnContainsMessage(turn, previous.streamingCaretMessageId)
    ? previous.streamingCaretMessageId
    : null;
  const nextCaret = turnContainsMessage(turn, next.streamingCaretMessageId)
    ? next.streamingCaretMessageId
    : null;
  if (previousCaret !== nextCaret) return false;
  for (const item of turn.items) {
    const messageId = item.message.id;
    if (
      previous.enteringIds.has(messageId) !== next.enteringIds.has(messageId) ||
      previous.exploreFoldedMessageIds.has(messageId) !==
        next.exploreFoldedMessageIds.has(messageId) ||
      !exploreFlowRolesEqual(
        previous.exploreRolesByMessageId.get(messageId),
        next.exploreRolesByMessageId.get(messageId),
      )
    ) {
      return false;
    }
  }
  return areThreadPropsEqualForTurn(turn, previous.props, next.props, wasCurrent || isCurrent);
}
