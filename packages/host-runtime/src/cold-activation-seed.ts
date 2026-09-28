/**
 * Cold-activation native replay seed (spec: session-conversation-tree §4.4).
 *
 * When a cold session owns native context copies, the reconstructed backend is
 * seeded with full-fidelity Pi messages instead of the text-injection prompt
 * prefix. Sessions without native copies return undefined and keep the
 * existing bounded text-injection path.
 */

import type { CreateSessionOptions, SessionTranscriptMessage } from '@piwin/contracts';
import {
  buildReplaySeedMessages,
  type ReplaySeedSourceRow,
  type SessionTranscriptStore,
} from '@piwin/session';

const COLD_ACTIVATION_TAIL_LIMIT = 100;

export async function buildColdActivationSeedOptions(
  store: SessionTranscriptStore,
  excludeMessageId?: string,
): Promise<CreateSessionOptions | undefined> {
  const compaction = await store.readLatestCompaction();
  const tail =
    compaction?.anchorMessageId !== undefined && compaction.anchorMessageId !== null
      ? await listMessagesAfterAnchor(store, compaction.anchorMessageId)
      : await store.listTail(COLD_ACTIVATION_TAIL_LIMIT);
  const rows: ReplaySeedSourceRow[] = [];
  if (compaction === undefined) {
    // The tail window can open inside a long tool loop. Carry the user row
    // that owns it so the replay seed can anchor the turn (see
    // buildReplaySeedMessages). A compaction summary already opens the
    // context as user-role text, so that path needs no anchor.
    const owner = await findOwningUserRow(store, tail[0]);
    if (owner !== undefined) rows.push({ message: owner, native: [] });
  }
  for (const message of tail) {
    if (excludeMessageId !== undefined && message.id === excludeMessageId) {
      continue;
    }
    rows.push({ message, native: await store.readNativeEntries(message.id) });
  }
  const { seedMessages, nativeRowCount } = buildReplaySeedMessages(rows);
  if (nativeRowCount === 0 && compaction === undefined) {
    return undefined;
  }
  return {
    ...(seedMessages.length > 0 ? { seedMessages } : {}),
    seedMode: 'replay',
    ...(compaction
      ? {
          compactionSeed: {
            summary: compaction.summary,
            ...(compaction.tokensBefore !== undefined
              ? { tokensBefore: compaction.tokensBefore }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * Nearest active-path user row before `first`, when `first` is not itself a
 * user row. Walks the active path once; only reached when a cold replay would
 * otherwise start mid-turn.
 */
async function findOwningUserRow(
  store: SessionTranscriptStore,
  first: SessionTranscriptMessage | undefined,
): Promise<SessionTranscriptMessage | undefined> {
  if (first === undefined || first.role === 'user') return undefined;
  let owner: SessionTranscriptMessage | undefined;
  for await (const message of store.iterateActivePath()) {
    if (message.id === first.id) return owner;
    if (message.role === 'user' && message.text.trim().length > 0) owner = message;
  }
  return undefined;
}

/**
 * A persisted compaction summary already covers its anchor and everything
 * before it. Replay only the active-path rows appended after that anchor so a
 * rebuilt runtime does not send the summarized history twice.
 */
async function listMessagesAfterAnchor(
  store: SessionTranscriptStore,
  anchorMessageId: string,
): Promise<SessionTranscriptMessage[]> {
  const messages: SessionTranscriptMessage[] = [];
  let afterAnchor = false;
  for await (const message of store.iterateActivePath()) {
    if (afterAnchor) {
      messages.push(message);
      if (messages.length > COLD_ACTIVATION_TAIL_LIMIT) {
        messages.shift();
      }
    } else if (message.id === anchorMessageId) {
      afterAnchor = true;
    }
  }
  return messages;
}
