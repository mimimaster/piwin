import type { HostCommand } from './ipc.js';
import { remoteCommandRequiresIdempotencyKey } from './remote-idempotency.js';

export const HOST_COMMAND_REQUEST_ENVELOPE_VERSION = 1 as const;

/** Versioned local JSONL / Tauri ingress envelope. */
export type HostCommandRequestEnvelope = {
  v: typeof HOST_COMMAND_REQUEST_ENVELOPE_VERSION;
  command: HostCommand;
  idempotencyKey?: string;
  clientPrincipalId?: string;
};

/** Transport-neutral mutation identity after envelope or bare-command parse. */
export type HostCommandRequest = {
  command: HostCommand;
  idempotencyKey?: string;
  clientPrincipalId?: string;
};

export function isHostCommandRequestEnvelope(value: unknown): value is HostCommandRequestEnvelope {
  if (!isRecord(value) || value.v !== HOST_COMMAND_REQUEST_ENVELOPE_VERSION) {
    return false;
  }
  return isRecord(value.command) && typeof value.command.type === 'string';
}

/**
 * Accept a versioned envelope or a bare `HostCommand` line. Bare mutations
 * that require a key keep the key absent so admission can refuse them.
 */
export function parseHostCommandRequest(value: unknown): HostCommandRequest | { error: string } {
  if (!isRecord(value)) {
    return { error: 'Host command request must be an object' };
  }
  if (isHostCommandRequestEnvelope(value)) {
    return {
      command: value.command,
      ...(typeof value.idempotencyKey === 'string' && value.idempotencyKey.trim().length > 0
        ? { idempotencyKey: value.idempotencyKey.trim() }
        : {}),
      ...(typeof value.clientPrincipalId === 'string' && value.clientPrincipalId.trim().length > 0
        ? { clientPrincipalId: value.clientPrincipalId.trim() }
        : {}),
    };
  }
  if (typeof value.type !== 'string' || value.type.length === 0) {
    return { error: 'Host command request requires a command type' };
  }
  return { command: value as unknown as HostCommand };
}

export function hostCommandRequestRequiresIdempotencyKey(command: HostCommand): boolean {
  return remoteCommandRequiresIdempotencyKey(command.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
