import type { HostCommand, HostResponse, ModelRef, ThinkingLevel } from '@piwin/contracts';
import { toError } from './mobile-host-helpers.js';

export type MobileHostRequester = (command: HostCommand) => Promise<HostResponse>;

export type MobileComposerProfileRequest = (
  command: Extract<HostCommand, { type: 'session/set-composer-profile' }>,
) => Promise<HostResponse>;

export type CommitMobileComposerProfileArgs = {
  request: MobileComposerProfileRequest;
  sessionId: string | null | undefined;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};

export type CommitMobileComposerProfileResult = { ok: true } | { ok: false; error: string };

export function createMobileComposerProfileRequest(
  request: MobileHostRequester | undefined,
): MobileComposerProfileRequest {
  return (command) => {
    if (request === undefined) {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: false,
        error: '未连接到 Host。',
      });
    }
    return request(command);
  };
}

/**
 * Writes desired composer profile for an existing mobile session.
 * No session (empty draft) skips Host; caller still owns local picker state.
 */
export async function commitMobileComposerProfile(
  args: CommitMobileComposerProfileArgs,
): Promise<CommitMobileComposerProfileResult> {
  if (args.sessionId == null || args.sessionId.length === 0) {
    return { ok: true };
  }

  const command: Extract<HostCommand, { type: 'session/set-composer-profile' }> = {
    type: 'session/set-composer-profile',
    sessionId: args.sessionId,
    ...(args.model ? { model: args.model } : {}),
    ...(args.thinkingLevel !== undefined ? { thinkingLevel: args.thinkingLevel } : {}),
  };

  try {
    const response = await args.request(command);
    if (!response.success) {
      return { ok: false, error: response.error };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toError(error, '更新会话模型失败。').message };
  }
}
