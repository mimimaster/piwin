import type { HostPairingCommand, HostWireMessage } from '@piwin/contracts';
import { isHostPairingCommandType } from '@piwin/contracts';
import { applyBrowserLeaseCommand } from './browser-mirror-leases.js';
import type { HostClientConnection } from './host-client-connection.js';
import { evaluateHostCommandAdmission } from './host-command-admission.js';
import {
  admitAndExecuteHostCommand,
  type HostCommandIdempotencyRegistry,
} from './host-command-idempotency-registry.js';
import type { HostConnectionSender } from './host-connection-send.js';
import {
  handleHostPairingCommand,
  type HostPairingCommandContext,
} from './host-pairing-commands.js';
import { rememberRemoteMediaAsset, resolveRemoteCommand, toError } from './host-server-support.js';
import { isLiveOwnerConnection } from './live-remote-gate.js';
import { projectRemoteResponse, type RemoteProjectionContext } from './remote-projection.js';
import type { HostRuntimePort } from './host-runtime-port.js';
import { stampSubscriptionAuthCommand } from './stamp-subscription-auth.js';

type CommandFrame = Extract<HostWireMessage, { type: 'command' }>;

/** Live server state one command needs; supplied fresh per call by HostServer. */
export type HostCommandDispatchHost = {
  runtime: HostRuntimePort;
  idempotencyRegistry: HostCommandIdempotencyRegistry;
  remoteMediaPaths: Map<string, string>;
  loopbackHost: boolean;
  sender: Pick<HostConnectionSender, 'sendError' | 'sendResponse'>;
  pairingContext: (connection: HostClientConnection) => HostPairingCommandContext;
  projectionContext: (connection: HostClientConnection) => RemoteProjectionContext;
};

/**
 * Routes one admitted `command` frame. Pairing commands belong to the server's
 * pairing registry and never reach HostRuntime; everything else passes the
 * admission gate and the idempotency registry before the runtime executes it.
 */
export async function dispatchHostCommand(
  host: HostCommandDispatchHost,
  connection: HostClientConnection,
  frame: CommandFrame,
): Promise<void> {
  if (isHostPairingCommandType(frame.command.type)) {
    const response = await handleHostPairingCommand(
      frame.command as HostPairingCommand,
      host.pairingContext(connection),
    );
    await host.sender.sendResponse(connection, {
      type: 'response',
      requestId: frame.requestId,
      response,
    });
    return;
  }
  const admission = evaluateHostCommandAdmission({
    command: frame.command,
    liveOwner: isLiveOwnerConnection({
      loopbackHost: host.loopbackHost,
      ...(connection.deviceId === undefined ? {} : { pairedDeviceId: connection.deviceId }),
    }),
  });
  if (admission.kind === 'reject-error-frame') {
    host.sender.sendError(connection, 'command-not-allowed', admission.message, frame.requestId);
    return;
  }
  if (admission.kind === 'reject-response') {
    await host.sender.sendResponse(connection, {
      type: 'response',
      requestId: frame.requestId,
      response: {
        type: 'response',
        command: admission.command,
        success: false,
        error: admission.error,
        problem: {
          code: 'command-not-allowed',
          retryable: false,
          data: { reason: admission.reason },
        },
      },
    });
    return;
  }

  // The binary frame channel is gated on this client actually mirroring the
  // workbench (spec §4.1.2): remember its lease while it is the panel owner.
  const browserLeaseCommand =
    frame.command.type === 'browser/start' || frame.command.type === 'browser/stop'
      ? frame.command
      : undefined;

  try {
    const safeResponse = await admitAndExecuteHostCommand({
      registry: host.idempotencyRegistry,
      principalId: connection.idempotencyScope,
      idempotencyKey: frame.idempotencyKey,
      command: frame.command,
      execute: async () => {
        const remoteCommand = resolveRemoteCommand(
          stampSubscriptionAuthCommand(frame.command, {
            devicePrincipalId: connection.idempotencyScope,
          }),
          host.remoteMediaPaths,
        );
        const executeCommand = () =>
          frame.idempotencyKey
            ? host.runtime.handleCommand(remoteCommand, { idempotencyKey: frame.idempotencyKey })
            : host.runtime.handleCommand(remoteCommand);
        const response = host.runtime.runWithDevicePrincipal
          ? await host.runtime.runWithDevicePrincipal(connection.idempotencyScope, executeCommand)
          : await executeCommand();
        rememberRemoteMediaAsset(host.remoteMediaPaths, remoteCommand, response);
        return projectRemoteResponse(frame.command, response, host.projectionContext(connection));
      },
    });
    if (browserLeaseCommand !== undefined && safeResponse.success) {
      applyBrowserLeaseCommand(connection.browserMirrorLeases, browserLeaseCommand);
      if (connection.browserMirrorLeases.size === 0) {
        connection.pendingBrowserFrame = undefined;
      }
    }
    await host.sender.sendResponse(connection, {
      type: 'response',
      requestId: frame.requestId,
      response: safeResponse,
    });
  } catch (error) {
    host.sender.sendError(
      connection,
      'request-failed',
      toError(error, 'Host command failed').message,
      frame.requestId,
    );
  }
}
