import type { HostCommand, HostServerMessage } from '@piwin/contracts';
import { isLocalShellAccessCommandType } from '@piwin/contracts';
import type { LocalShellAccess } from '@piwin/host-server';

/**
 * Intercept `local-shell-access/open` before HostRuntime (ADR 0086). Returns
 * true when the frame was handled here and must not be dispatched as a
 * HostCommand. Only the sidecar's own stdio transport reaches this.
 */
export async function interceptSidecarLocalShellAccess(
  access: LocalShellAccess,
  command: HostCommand,
  send: (message: HostServerMessage) => Promise<void>,
): Promise<boolean> {
  if (!isLocalShellAccessCommandType(command.type)) {
    return false;
  }
  const identity = command.id === undefined ? {} : { id: command.id };
  try {
    const data = await access.open();
    await send({ type: 'response', command: command.type, success: true, data, ...identity });
  } catch (error) {
    await send({
      type: 'response',
      command: command.type,
      success: false,
      error: `Local shell entrance unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      ...identity,
    });
  }
  return true;
}
