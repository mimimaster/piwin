/**
 * Cold-activation native replay seed (spec: session-conversation-tree §4.4).
 *
 * When a cold session owns native context copies, the reconstructed backend is
 * seeded with full-fidelity Pi messages instead of the text-injection prompt
 * prefix. Sessions without native copies return undefined and keep the
 * existing bounded text-injection path.
 */

import type { CreateSessionOptions } from '@piwin/contracts';
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
  const tail = await store.listTail(COLD_ACTIVATION_TAIL_LIMIT);
  const rows: ReplaySeedSourceRow[] = [];
  for (const message of tail) {
    if (excludeMessageId !== undefined && message.id === excludeMessageId) {
      continue;
    }
    rows.push({ message, native: await store.readNativeEntries(message.id) });
  }
  const { seedMessages, nativeRowCount } = buildReplaySeedMessages(rows);
  if (nativeRowCount === 0) {
    return undefined;
  }
  return { seedMessages, seedMode: 'replay' };
}
