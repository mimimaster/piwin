/**
 * Local-only sidecar command for the terminal shell Desktop embeds (ADR 0086).
 *
 * Like `mobile-access/*`, this is **not** a `HostCommand`. The JSONL sidecar
 * intercepts it before `HostRuntime.handleCommand`, and HostServer must never
 * admit it from a WebSocket client: the reply carries a door token.
 */

export const LOCAL_SHELL_ACCESS_OPEN_COMMAND_TYPE = 'local-shell-access/open';

export type LocalShellAccessCommand = { id?: string; type: typeof LOCAL_SHELL_ACCESS_OPEN_COMMAND_TYPE };

/** Where a process on this machine can reach the sidecar Host, and the token that admits it. */
export type LocalShellAccessData = {
  /** Loopback WebSocket URL on an OS-assigned port. */
  endpoint: string;
  /** Random per sidecar run; never persisted. */
  authToken: string;
};

export function isLocalShellAccessCommandType(
  value: unknown,
): value is typeof LOCAL_SHELL_ACCESS_OPEN_COMMAND_TYPE {
  return value === LOCAL_SHELL_ACCESS_OPEN_COMMAND_TYPE;
}
