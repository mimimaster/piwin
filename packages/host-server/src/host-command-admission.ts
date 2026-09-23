import type { HostCommand } from '@piwin/contracts';
import { isLiveOwnerCommand, liveOwnerCommandRejectedReason } from './live-remote-gate.js';
import { isSafeRemoteCommand } from './host-server-support.js';

/**
 * What the Host answers a command it refuses before the Runtime ever sees it.
 * - `reject-error-frame` — the payload itself is unacceptable (no command ran).
 * - `reject-response` — a failed command response, so the client keeps the
 *   request/response pairing it expects for that command.
 */
export type HostCommandAdmission =
  | { kind: 'allowed' }
  | { kind: 'reject-error-frame'; message: string }
  | { kind: 'reject-response'; command: HostCommand['type']; error: string; reason: string };

/**
 * The admission gates that sit in front of HostRuntime: payload safety,
 * live-media ownership, and remote prompt admission. Scheduling itself
 * (`if-idle` / `replace-run`) stays in HostRuntime.
 */
export function evaluateHostCommandAdmission(input: {
  command: HostCommand;
  liveOwner: boolean;
}): HostCommandAdmission {
  if (!isSafeRemoteCommandPayload(input.command)) {
    return {
      kind: 'reject-error-frame',
      message: `Remote command payload was rejected: ${input.command.type}`,
    };
  }
  if (isLiveOwnerCommand(input.command.type) && !input.liveOwner) {
    return {
      kind: 'reject-response',
      command: input.command.type,
      error: liveOwnerCommandRejectedReason(),
      reason: 'live-local-owner-only',
    };
  }
  // Remote session/prompt must send `foreground`. Admission itself lives in
  // HostRuntime (`if-idle` / `replace-run`); this gate only rejects omit.
  if (input.command.type === 'session/prompt' && input.command.foreground === undefined) {
    return {
      kind: 'reject-response',
      command: 'session/prompt',
      error: 'Remote session/prompt requires foreground admission',
      reason: 'foreground-required',
    };
  }
  return { kind: 'allowed' };
}

/** Payload rejection is fail-closed: a validator that throws rejects the command. */
function isSafeRemoteCommandPayload(command: HostCommand): boolean {
  try {
    return isSafeRemoteCommand(command);
  } catch {
    return false;
  }
}
