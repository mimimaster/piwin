import type { HostCommand, HostServerMessage } from '@piwin/contracts';
import { isLocalMobileAccessCommand, isLocalMobileAccessCommandType } from '@piwin/contracts';
import {
  createMobileAccessController,
  type HostCommandIdempotencyRegistry,
  type HostEgressHub,
  type MobileAccessController,
} from '@piwin/host-server';
import type { HostRuntime } from '@piwin/host-runtime';

export type MobileAccessServeSend = (message: HostServerMessage) => Promise<void>;

export async function createSidecarMobileAccess(options: {
  runtime: Pick<HostRuntime, 'handleCommand' | 'attachPushSink'>;
  instanceId: string;
  piwinRoot: string;
  clientToolBroker?: import('@piwin/host-server').DeviceToolBroker;
  egressHub?: HostEgressHub;
  idempotencyRegistry?: HostCommandIdempotencyRegistry;
}): Promise<MobileAccessController> {
  const bindPort = parseMobileAccessBindPort(process.env.PIWIN_MOBILE_ACCESS_PORT);
  return createMobileAccessController({
    runtime: options.runtime,
    instanceId: options.instanceId,
    piwinRoot: options.piwinRoot,
    bindHost: '127.0.0.1',
    ...(bindPort === undefined ? {} : { bindPort }),
    onError: (error) => {
      console.error(`[piwin host serve] phone-access error: ${error.message}`);
    },
    ...(options.clientToolBroker === undefined ? {} : { clientToolBroker: options.clientToolBroker }),
    ...(options.egressHub === undefined ? {} : { egressHub: options.egressHub }),
    ...(options.idempotencyRegistry === undefined
      ? {}
      : { idempotencyRegistry: options.idempotencyRegistry }),
  });
}

/**
 * Intercept local `mobile-access/*` before HostRuntime. Returns true when the
 * frame was handled here and must not be dispatched as a HostCommand.
 */
export async function interceptSidecarMobileAccess(
  controller: MobileAccessController | undefined,
  command: HostCommand,
  send: MobileAccessServeSend,
): Promise<boolean> {
  if (!isLocalMobileAccessCommandType(command.type)) {
    return false;
  }
  if (controller === undefined) {
    await send({
      type: 'response',
      command: command.type,
      success: false,
      error: 'Phone access is unavailable on this sidecar',
      ...(command.id === undefined ? {} : { id: command.id }),
    });
    return true;
  }
  const localCommand: unknown = command;
  if (!isLocalMobileAccessCommand(localCommand)) {
    await send({
      type: 'response',
      command: command.type,
      success: false,
      error: 'Invalid mobile-access command',
      ...(command.id === undefined ? {} : { id: command.id }),
    });
    return true;
  }
  await send(await controller.handle(localCommand));
  return true;
}

function parseMobileAccessBindPort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  const port = Number(trimmed);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    return undefined;
  }
  return port;
}
