import type { SessionTurnSummary } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';

export type TranscriptTurnItem = {
  message: ChatMessageUi;
  messageIndex: number;
};

export type TranscriptTurn = {
  id: string;
  summary?: SessionTurnSummary;
  items: TranscriptTurnItem[];
  lastAssistantMessageId: string | null;
};

/** User prompt that opened this turn, if the turn started with a user row. */
export function turnUserMessageId(turn: TranscriptTurn): string | null {
  return turn.items.find((item) => item.message.role === 'user')?.message.id ?? null;
}
/** Which turn id each resident message belonged to the last time turns were grouped. */
export type TranscriptTurnIdRegistry = ReadonlyMap<string, string>;

export const EMPTY_TRANSCRIPT_TURN_ID_REGISTRY: TranscriptTurnIdRegistry = new Map();

/**
 * Group one user prompt and its following assistant activity into a render unit.
 * Turn-level units keep virtualization from splitting coupled work details and
 * the final assistant response across independent measurement boundaries.
 *
 * A turn opened from a tail page starts at whichever row the page began with;
 * an older page then prepends its head (and its prompt). The turn is the same
 * one the reader was looking at, so `previous` lets it keep the id it had —
 * otherwise React, the virtualizer and the height cache all treat it as a
 * different row and remount it under the reader.
 */
export function groupTranscriptTurns(
  messages: readonly ChatMessageUi[],
  previous: TranscriptTurnIdRegistry = EMPTY_TRANSCRIPT_TURN_ID_REGISTRY,
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let currentTurn: TranscriptTurn | null = null;

  messages.forEach((message, messageIndex) => {
    if (message.role === 'user' || currentTurn === null) {
      currentTurn = {
        id: `turn-${message.id}`,
        items: [],
        lastAssistantMessageId: null,
      };
      turns.push(currentTurn);
    }

    if (message.turnSummary && currentTurn.summary === undefined) {
      currentTurn.summary = message.turnSummary;
      currentTurn.id = message.turnSummary.turnId;
    }
    currentTurn.items.push({ message, messageIndex });
    if (message.role === 'assistant') {
      currentTurn.lastAssistantMessageId = message.id;
    }
  });

  if (previous.size === 0) return turns;
  const claimed = new Set<string>();
  return turns.map((turn) => {
    // Oldest resident message that already had an id wins; a turn that a
    // window trim split cannot hand the same id to both halves.
    let inherited: string | undefined;
    for (const item of turn.items) {
      const candidate = previous.get(item.message.id);
      if (candidate !== undefined && !claimed.has(candidate)) {
        inherited = candidate;
        break;
      }
    }
    let id = turn.summary?.turnId ?? inherited ?? turn.id;
    // A fresh id can only collide with an inherited one when the split happened
    // on a message that used to head another turn.
    for (let suffix = 2; claimed.has(id); suffix += 1) id = `${turn.id}~${suffix}`;
    claimed.add(id);
    return id === turn.id ? turn : { ...turn, id };
  });
}

function isSameTranscriptTurn(previous: TranscriptTurn, next: TranscriptTurn): boolean {
  if (
    previous.id !== next.id ||
    previous.summary !== next.summary ||
    previous.lastAssistantMessageId !== next.lastAssistantMessageId ||
    previous.items.length !== next.items.length
  ) {
    return false;
  }
  return previous.items.every((item, index) => {
    const nextItem = next.items[index];
    return (
      nextItem !== undefined &&
      item.message === nextItem.message &&
      item.messageIndex === nextItem.messageIndex
    );
  });
}

/**
 * Hand back the previous turn object wherever a regrouping produced the same
 * turn. Grouping runs on every token, and only the live turn's messages
 * change; without this every settled turn is a new object each time and no
 * turn-level memo (or per-turn cache keyed on the object) can ever hit.
 */
export function reuseUnchangedTranscriptTurns(
  previous: readonly TranscriptTurn[],
  next: TranscriptTurn[],
): TranscriptTurn[] {
  if (previous.length === 0) return next;
  const previousById = new Map(previous.map((turn) => [turn.id, turn]));
  return next.map((turn) => {
    const candidate = previousById.get(turn.id);
    return candidate !== undefined && isSameTranscriptTurn(candidate, turn) ? candidate : turn;
  });
}

/** Remember the ids of the current turns; pruned to what is resident, so it never grows. */
export function registerTranscriptTurnIds(
  turns: readonly TranscriptTurn[],
): TranscriptTurnIdRegistry {
  const registry = new Map<string, string>();
  for (const turn of turns) {
    for (const item of turn.items) registry.set(item.message.id, turn.id);
  }
  return registry;
}

export function indexTranscriptTurnsByMessageId(
  turns: readonly TranscriptTurn[],
): ReadonlyMap<string, number> {
  const indexByMessageId = new Map<string, number>();
  turns.forEach((turn, turnIndex) => {
    for (const item of turn.items) {
      indexByMessageId.set(item.message.id, turnIndex);
    }
  });
  return indexByMessageId;
}
