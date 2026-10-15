import {
  formatError,
  type HostCommand,
  type HostResponse,
  type ModelRef,
  type ThinkingLevel,
} from '@piwin/contracts';

export type SessionComposerProfileRequest = (
  command: Extract<HostCommand, { type: 'session/set-composer-profile' }>,
) => Promise<HostResponse>;

export type CommitSessionComposerProfileArgs = {
  request: SessionComposerProfileRequest;
  sessionId: string | null;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  /** Scheme id, or `off` to return the conversation to freehand. */
  orchestrationSchemeId?: string;
  delegationDisabled?: boolean;
};

export type CommitSessionComposerProfileResult = { ok: true } | { ok: false; error: string };

/**
 * Writes desired composer profile for an existing session.
 * Empty draft (`sessionId` null) skips Host — caller still owns local + global persist.
 */
export async function commitSessionComposerProfile(
  args: CommitSessionComposerProfileArgs,
): Promise<CommitSessionComposerProfileResult> {
  if (args.sessionId == null || args.sessionId.length === 0) {
    return { ok: true };
  }

  const command: Extract<HostCommand, { type: 'session/set-composer-profile' }> = {
    type: 'session/set-composer-profile',
    sessionId: args.sessionId,
    ...(args.model ? { model: args.model } : {}),
    ...(args.thinkingLevel !== undefined ? { thinkingLevel: args.thinkingLevel } : {}),
    ...(args.orchestrationSchemeId !== undefined
      ? { orchestrationSchemeId: args.orchestrationSchemeId }
      : {}),
    ...(args.delegationDisabled !== undefined
      ? { delegationDisabled: args.delegationDisabled }
      : {}),
  };

  try {
    const response = await args.request(command);
    if (!response.success) {
      return { ok: false, error: response.error };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}
