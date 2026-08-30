/**
 * Resolve the composer profile for one session/prompt turn.
 * desired = input ?? index record ?? last-applied; last-applied is sessionModels.
 */
import type { ModelRef, PromptInput, SessionIndexRecord, ThinkingLevel } from '@piwin/contracts';

export type SessionTurnProfileSource = {
  input: Pick<PromptInput, 'model' | 'thinkingLevel'>;
  record: Pick<SessionIndexRecord, 'model' | 'thinkingLevel'> | null | undefined;
  appliedModel: ModelRef | undefined;
  hasLiveHandle: boolean;
};

export type SessionTurnProfile = {
  desiredModel: ModelRef | undefined;
  desiredThinkingLevel: ThinkingLevel | undefined;
  previousModel: ModelRef | undefined;
  requiresModelRuntimeReplacement: boolean;
};

export function resolveSessionTurnProfile(source: SessionTurnProfileSource): SessionTurnProfile {
  const desiredModel = source.input.model ?? source.record?.model ?? source.appliedModel;
  const desiredThinkingLevel = source.input.thinkingLevel ?? source.record?.thinkingLevel;
  const previousModel = source.appliedModel;
  const requiresModelRuntimeReplacement =
    desiredModel !== undefined &&
    source.hasLiveHandle &&
    (previousModel === undefined || previousModel.providerId !== desiredModel.providerId);
  return {
    desiredModel,
    desiredThinkingLevel,
    previousModel,
    requiresModelRuntimeReplacement,
  };
}
