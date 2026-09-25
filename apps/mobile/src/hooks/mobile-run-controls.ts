import type { HostClient } from '@piwin/host-client';
import {
  buildMobileAbortCommand,
  buildMobilePermissionResolveCommand,
  createMobileIdempotencyKey,
  executeMobileMutation,
} from '../mobile-prompt-send.js';
import { toError } from '../mobile-host-helpers.js';

/** Resolves to an error message, or undefined when the Host accepted the stop. */
export async function abortMobileRun(
  client: HostClient,
  sessionId: string,
  runId: string,
): Promise<string | undefined> {
  try {
    const response = await executeMobileMutation(
      (command, options) => client.request(command, options),
      buildMobileAbortCommand(sessionId, runId),
      createMobileIdempotencyKey(),
    );
    return response.success ? undefined : response.error;
  } catch (error) {
    return toError(error, '停止运行失败。').message;
  }
}

/** Relays 允/否 plus the remember scope; the Host owns the decision. */
export async function resolveMobilePermission(
  client: HostClient,
  requestId: string,
  decision: 'allow' | 'deny',
  rememberScope: 'once' | 'session' | 'project',
): Promise<string | undefined> {
  try {
    const response = await executeMobileMutation(
      (command, options) => client.request(command, options),
      buildMobilePermissionResolveCommand(requestId, decision, rememberScope),
      createMobileIdempotencyKey(),
    );
    return response.success ? undefined : response.error;
  } catch (error) {
    return toError(error, '处理权限请求失败。').message;
  }
}
