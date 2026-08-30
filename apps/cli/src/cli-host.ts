import type { HostCommand, HostResponse } from '@piwin/contracts';
import { remoteCommandRequiresIdempotencyKey } from '@piwin/contracts';
import {
  createHostRequestAttempt,
  createIdempotencyKey,
  executeHostRequestAttempt,
} from '@piwin/host-client';
import { HostRuntime } from '@piwin/host-runtime';
import { connectCliAttachedHost, readCliHostAttachTarget } from './attach-existing-host.js';

export type CliHostRequestOptions = {
  idempotencyKey?: string;
};

export type CliHostHandle = {
  handleCommand: (
    command: HostCommand,
    options?: CliHostRequestOptions,
  ) => Promise<HostResponse>;
  dispose: () => Promise<void>;
  transport: 'in-process' | 'attached';
};

export function newCliGestureKey(): CliHostRequestOptions {
  return { idempotencyKey: createIdempotencyKey() };
}

/**
 * One Host per `~/.piwin`. When `PIWIN_HOST_URL` is set, attach instead of
 * constructing a second `HostRuntime`.
 */
export async function openCliHost(
  options: ConstructorParameters<typeof HostRuntime>[0],
): Promise<CliHostHandle> {
  const target = readCliHostAttachTarget();
  if (target) {
    const client = await connectCliAttachedHost(target, options.piwinRoot);
    const unsubscribe =
      options.onPush === undefined
        ? () => undefined
        : client.subscribePush((push) => {
            options.onPush?.(push);
          });
    return {
      transport: 'attached',
      handleCommand: createAttachedCliCommandHandler((command, options) =>
        client.request(command, options),
      ),
      dispose: async () => {
        unsubscribe();
        await client.close();
      },
    };
  }
  const runtime = new HostRuntime(options);
  return {
    transport: 'in-process',
    handleCommand: (command, requestOptions) => runtime.handleCommand(command, requestOptions),
    dispose: () => runtime.dispose(),
  };
}

export function createAttachedCliCommandHandler(
  request: (command: HostCommand, options?: { idempotencyKey?: string }) => Promise<HostResponse>,
): CliHostHandle['handleCommand'] {
  return (command, options) => {
    if (!remoteCommandRequiresIdempotencyKey(command.type)) {
      return request(command);
    }
    const key = options?.idempotencyKey?.trim();
    if (key === undefined || key.length === 0) {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: false,
        error: 'idempotency-key-required',
        problem: { code: 'idempotency-key-required' },
      });
    }
    return executeHostRequestAttempt(
      (sent, requestOptions) => request(sent, requestOptions),
      createHostRequestAttempt(command, key),
    );
  };
}
