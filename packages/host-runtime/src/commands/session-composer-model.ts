import {
  ORCHESTRATION_SCHEME_OFF_ID,
  type ModelRef,
  type SessionTranscriptMessage,
  type ThinkingLevel,
} from '@piwin/contracts';
import { getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import type { SessionLiveContext } from './session-live-context.js';

/** Composer model/thinking/orchestration: persisted on the session index, recovered from transcript. */

export type SessionComposerProfile = {
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  /** Scheme id, or `off` to clear back to freehand. */
  orchestrationSchemeId?: string;
  /** `false` clears the stored flag. */
  delegationDisabled?: boolean;
};

export function isEmptySessionComposerProfile(profile: SessionComposerProfile): boolean {
  return (
    !profile.model &&
    profile.thinkingLevel === undefined &&
    profile.orchestrationSchemeId === undefined &&
    profile.delegationDisabled === undefined
  );
}

/**
 * Persist the last composer profile onto the product session index so
 * resume and session switch can restore it after process restart.
 * Freehand and delegation-enabled are the absent defaults, so `off` / `false`
 * delete the field rather than storing it.
 */
export async function persistSessionComposerProfile(
  context: Pick<SessionLiveContext, 'piwinRoot'>,
  sessionId: string,
  profile: SessionComposerProfile,
): Promise<void> {
  if (isEmptySessionComposerProfile(profile)) {
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
  if (profile.orchestrationSchemeId !== undefined) {
    const schemeId = profile.orchestrationSchemeId.trim();
    if (schemeId === '' || schemeId === ORCHESTRATION_SCHEME_OFF_ID) {
      if (record.orchestrationSchemeId !== undefined) {
        delete record.orchestrationSchemeId;
        changed = true;
      }
    } else if (record.orchestrationSchemeId !== schemeId) {
      record.orchestrationSchemeId = schemeId;
      changed = true;
    }
  }
  if (profile.delegationDisabled === true && record.delegationDisabled !== true) {
    record.delegationDisabled = true;
    changed = true;
  } else if (profile.delegationDisabled === false && record.delegationDisabled !== undefined) {
    delete record.delegationDisabled;
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
