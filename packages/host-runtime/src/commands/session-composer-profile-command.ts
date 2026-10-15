/**
 * Desired session composer profile: writes index record.model / thinkingLevel /
 * orchestrationSchemeId / delegationDisabled and pushes session/index-updated. Does not apply runtime, sessionModels, or compact.
 */
import type {
  HostCommand,
  HostPush,
  HostResponse,
  ModelRef,
  PiwinConfig,
  SessionIndexRecord,
} from '@piwin/contracts';
import {
  isValidOrchestrationSchemeId,
  modelSupportsCapability,
  ORCHESTRATION_SCHEME_OFF_ID,
} from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { findEnabledModel } from '../provider-helpers.js';
import { persistSessionComposerProfile } from './prompt-preparation.js';
import {
  isEmptySessionComposerProfile,
  type SessionComposerProfile,
} from './session-composer-model.js';

export type SessionComposerProfileCommandContext = {
  piwinRoot?: string;
  push: (message: HostPush) => void;
  loadConfig: () => Promise<PiwinConfig>;
};

function sameModel(left: ModelRef | undefined, right: ModelRef | undefined): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.protocol === right.protocol &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId
  );
}

function composerProfileUnchanged(
  before: SessionIndexRecord,
  after: SessionIndexRecord,
): boolean {
  return (
    sameModel(before.model, after.model) &&
    before.thinkingLevel === after.thinkingLevel &&
    before.orchestrationSchemeId === after.orchestrationSchemeId &&
    before.delegationDisabled === after.delegationDisabled
  );
}

export async function handleSessionComposerProfileCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionComposerProfileCommandContext,
): Promise<HostResponse | null> {
  if (command.type !== 'session/set-composer-profile') {
    return null;
  }

  const profile: SessionComposerProfile = {
    ...(command.model ? { model: command.model } : {}),
    ...(command.thinkingLevel !== undefined ? { thinkingLevel: command.thinkingLevel } : {}),
    ...(command.orchestrationSchemeId !== undefined
      ? { orchestrationSchemeId: command.orchestrationSchemeId.trim() }
      : {}),
    ...(command.delegationDisabled !== undefined
      ? { delegationDisabled: command.delegationDisabled }
      : {}),
  };
  if (isEmptySessionComposerProfile(profile)) {
    return fail(
      requestId,
      command.type,
      'model, thinkingLevel, orchestrationSchemeId, or delegationDisabled is required',
    );
  }
  // A scheme deleted from Settings later is fine to keep: Desktop falls back
  // to freehand on read. Only malformed ids are refused here.
  const schemeId = profile.orchestrationSchemeId;
  if (
    schemeId !== undefined &&
    schemeId !== ORCHESTRATION_SCHEME_OFF_ID &&
    !isValidOrchestrationSchemeId(schemeId)
  ) {
    return fail(
      requestId,
      command.type,
      `invalid orchestration scheme id "${schemeId}" (expected [a-z0-9-]+ or off)`,
    );
  }

  const indexPath = getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot));
  const existing = await getSessionRecord(indexPath, command.sessionId);
  if (!existing) {
    return fail(requestId, command.type, `Unknown session: ${command.sessionId}`);
  }

  if (command.model) {
    const config = await context.loadConfig();
    const configured = findEnabledModel(
      config,
      command.model.providerId,
      command.model.modelId,
    );
    if (!configured || !modelSupportsCapability(configured, 'chat')) {
      return fail(
        requestId,
        command.type,
        `model-unavailable: ${command.model.providerId}/${command.model.modelId} is not an enabled chat model`,
      );
    }
  }

  await persistSessionComposerProfile(
    context.piwinRoot === undefined ? {} : { piwinRoot: context.piwinRoot },
    command.sessionId,
    profile,
  );

  const record = await getSessionRecord(indexPath, command.sessionId);
  if (!record) {
    return fail(requestId, command.type, `Unknown session: ${command.sessionId}`);
  }

  const session = indexRecordToSummary(record);
  const unchanged = composerProfileUnchanged(existing, record);
  if (!unchanged) {
    context.push(
      sessionIndexUpdatedPush({
        op: 'updated',
        sessionId: command.sessionId,
        session,
      }),
    );
  }

  return ok(requestId, command.type, { ok: true, unchanged, session });
}
