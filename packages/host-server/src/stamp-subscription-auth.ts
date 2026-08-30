import type { HostCommand } from '@piwin/contracts';

export type SubscriptionAuthConnectionIdentity = {
  devicePrincipalId: string;
};

/** Stamp connection identity onto auth commands. Browser OAuth stays the default. */
export function stampSubscriptionAuthCommand(
  command: HostCommand,
  identity: SubscriptionAuthConnectionIdentity,
): HostCommand {
  const principal = identity.devicePrincipalId.trim();
  if (command.type === 'auth/login') {
    return {
      ...command,
      input: {
        ...command.input,
        ...(principal.length > 0 ? { ownerDeviceId: principal } : {}),
      },
    };
  }
  if (command.type === 'auth/respond') {
    return {
      ...command,
      input: {
        ...command.input,
        ...(principal.length > 0 ? { ownerDeviceId: principal } : {}),
      },
    };
  }
  if (command.type === 'auth/cancel') {
    return {
      ...command,
      ...(principal.length > 0 ? { ownerDeviceId: principal } : {}),
    };
  }
  if (command.type === 'auth/claim') {
    return {
      ...command,
      input: {
        ...command.input,
        ...(principal.length > 0 ? { ownerDeviceId: principal } : {}),
      },
    };
  }
  return command;
}
