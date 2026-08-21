import { randomUUID } from 'node:crypto';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { remoteCommandRequiresIdempotencyKey } from '@piwin/contracts';
import { HostRuntime } from '@piwin/host-runtime';
import { connectCliAttachedHost, readCliHostAttachTarget } from './attach-existing-host.js';

export type CliHostHandle = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
  dispose: () => Promise<void>;
  transport: 'in-process' | 'attached';
};

/**
 * One Host per `~/.piwin`. When `PIWIN_HOST_URL` is set, attach instead of
 * constructing a second `HostRuntime`.
 */
export async function openCliHost(
  options: ConstructorParameters<typeof HostRuntime>[0],
): Promise<CliHostHandle> {
  const target = readCliHostAttachTarget();
  if (target) {
    const client = await connectCliAttachedHost(target);
    const unsubscribe =
      options.onPush === undefined
        ? () => undefined
        : client.subscribePush((push) => {
            options.onPush?.(push);
          });
    return {
      transport: 'attached',
      handleCommand: (command) => {
        if (remoteCommandRequiresIdempotencyKey(command.type)) {
          return client.request(command, { idempotencyKey: randomUUID() });
        }
        return client.request(command);
      },
      dispose: async () => {
        unsubscribe();
        await client.close();
      },
    };
  }
  const runtime = new HostRuntime(options);
  return {
    transport: 'in-process',
    handleCommand: (command) => runtime.handleCommand(command),
    dispose: () => runtime.dispose(),
  };
}
