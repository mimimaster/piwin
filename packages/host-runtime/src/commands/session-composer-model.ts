import type {
  ModelRef,
  SessionTranscriptMessage,
  ThinkingLevel,
} from '@piwin/contracts';
import { getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import type { SessionLiveContext } from './session-live-context.js';

/** Composer model/thinking: persisted on the session index, recovered from transcript. */

/**
 * Persist the last composer model/thinking onto the product session index so
 * resume and session switch can restore them after process restart.
 */
export async function persistSessionComposerProfile(
  context: Pick<SessionLiveContext, 'piwinRoot'>,
  sessionId: string,
  profile: { model?: ModelRef; thinkingLevel?: ThinkingLevel },
): Promise<void> {
  if (!profile.model && profile.thinkingLevel === undefined) {
    return;
  }
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, sessionId);
  if (!record) {
    return;
  }
  let changed = false;
  if (profile.model) {
    const previous = record.model;
    const sameModel =
      previous &&
      previous.protocol === profile.model.protocol &&
      previous.providerId === profile.model.providerId &&
      previous.modelId === profile.model.modelId;
    if (!sameModel) {
      record.model = profile.model;
      changed = true;
    }
  }
  if (profile.thinkingLevel !== undefined && record.thinkingLevel !== profile.thinkingLevel) {
    record.thinkingLevel = profile.thinkingLevel;
    changed = true;
  }
  if (!changed) {
    return;
  }
  record.updatedAt = new Date().toISOString();
  await upsertSessionRecord(indexPath, record);
}

/** Recover the last assistant model snapshot from transcript (legacy sessions). */
export function recoverModelFromTranscript(
  messages: readonly SessionTranscriptMessage[],
): ModelRef | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.model) {
      return message.model;
    }
  }
  return undefined;
}
