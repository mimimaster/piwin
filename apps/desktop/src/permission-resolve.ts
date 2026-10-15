/**
 * Builds and sends `permission/resolve` for one prompt. The workbench bar and
 * conversation panes both resolve through here so the ADR 0082 backend-option
 * mapping and the remember-scope rule live in exactly one place.
 */
import type {
  HostCommand,
  HostResponse,
  PermissionDecision,
  PermissionRememberScope,
} from '@piwin/contracts';
import type { PermissionPromptUi } from './chat-ui-types';
import type { HostClient } from './host-client';
import { createGestureIdempotencyKey } from './gesture-idempotency.js';
import {
  backendOptionForDecision,
  backendPermissionOptions,
} from './backend-permission-options.js';

export type PermissionResolveCommand = Extract<HostCommand, { type: 'permission/resolve' }>;

export function buildPermissionResolveCommand(input: {
  prompt: PermissionPromptUi;
  decision: PermissionDecision;
  rememberScope?: PermissionRememberScope;
}): PermissionResolveCommand {
  const { prompt, decision } = input;
  const rememberScope = input.rememberScope ?? 'once';
  const payload: PermissionResolveCommand = {
    type: 'permission/resolve',
    requestId: prompt.requestId,
    decision,
  };
  const backendOptions = backendPermissionOptions(prompt.context);
  if (backendOptions !== undefined) {
    // ADR 0082: the agent's own option id, never a piwin remember scope.
    const option = backendOptionForDecision(backendOptions, decision, rememberScope);
    if (option !== undefined) {
      payload.backendOptionId = option.optionId;
    }
  } else if (decision === 'allow') {
    payload.rememberScope = rememberScope;
  }
  return payload;
}

/**
 * requestIds with a resolve already on the wire. A double-click or a keyboard
 * repeat on the same prompt must not send a second resolve for it.
 */
const resolvesInFlight = new Set<string>();

/**
 * Resolves `prompt` through Host. Returns null without sending when a resolve
 * for the same requestId is already in flight.
 */
export async function resolvePermissionPrompt(input: {
  hostClient: Pick<HostClient, 'request'>;
  prompt: PermissionPromptUi;
  decision: PermissionDecision;
  rememberScope?: PermissionRememberScope;
}): Promise<HostResponse | null> {
  const { requestId } = input.prompt;
  if (resolvesInFlight.has(requestId)) return null;
  resolvesInFlight.add(requestId);
  try {
    return await input.hostClient.request(buildPermissionResolveCommand(input), {
      idempotencyKey: createGestureIdempotencyKey(),
    });
  } finally {
    resolvesInFlight.delete(requestId);
  }
}
