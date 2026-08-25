import type { HostCommand, HostResponse } from '@piwin/contracts';
import { remoteCommandRequiresIdempotencyKey } from '@piwin/contracts';

export type HostRequestAttempt = {
  readonly idempotencyKey: string;
  readonly command: HostCommand;
};

export type HostRequestExecutor = (
  command: HostCommand,
  options?: { idempotencyKey?: string },
) => Promise<HostResponse>;

/** Freeze one user gesture. Transport retry must reuse this object. */
export function createHostRequestAttempt(
  command: HostCommand,
  idempotencyKey: string,
): HostRequestAttempt {
  const key = idempotencyKey.trim();
  if (remoteCommandRequiresIdempotencyKey(command.type) && key.length === 0) {
    throw new Error('idempotency-key-required');
  }
  return Object.freeze({
    idempotencyKey: key,
    command: Object.freeze({ ...command }) as HostCommand,
  });
}

export function executeHostRequestAttempt(
  request: HostRequestExecutor,
  attempt: HostRequestAttempt,
): Promise<HostResponse> {
  return request(attempt.command, { idempotencyKey: attempt.idempotencyKey });
}

export function createIdempotencyKey(): string {
  const cryptoObject = (
    globalThis as unknown as {
      crypto?: { randomUUID?: () => string };
    }
  ).crypto;
  if (cryptoObject?.randomUUID !== undefined) {
    return cryptoObject.randomUUID();
  }
  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
