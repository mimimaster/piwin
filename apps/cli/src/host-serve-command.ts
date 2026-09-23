import { resolveHostDataRoot } from './host-data-root.js';
import { installHostDiagnosticLog } from './host-diagnostic-log.js';
import { createHostServeDispatcher } from './host-serve-dispatcher.js';
import {
  HOST_SERVE_LOCAL_EGRESS_LIMITS,
  createJsonlStdioTransport,
} from './host-serve-transport.js';
import { createSidecarMobileAccess, interceptSidecarMobileAccess } from './mobile-access-serve.js';
import { LOCAL_JSONL_CLIENT_ID, createSidecarHostAuthority } from './sidecar-host-authority.js';
import { HostRuntime, applyPiwinPlaywrightBrowsersPath } from '@piwin/host-runtime';
import { admitAndExecuteHostCommand, createDeviceToolBrokerForHost } from '@piwin/host-server';
import { resolve } from 'node:path';
import {
  parseHostServeTestFixture,
  parseMock,
  parseMode,
  resolvePermissionModeOverride,
} from './cli-args.js';

/**
 * `piwin host-serve` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandHostServe(argv: string[]): Promise<void> {
  const hostDataRoot = resolveHostDataRoot();
  installHostDiagnosticLog(hostDataRoot);
  const mode = parseMode(argv);
  const mock = parseMock(argv);
  const testFixture = parseHostServeTestFixture(argv);
  const permissionModeOverride = resolvePermissionModeOverride(argv);
  const transport = createJsonlStdioTransport();
  applyPiwinPlaywrightBrowsersPath(hostDataRoot);
  const runtimeOptions: ConstructorParameters<typeof HostRuntime>[0] = {
    mode,
    mock,
    piwinRoot: hostDataRoot,
  };
  // Source-tree multi-process E2E may pair the live Host source with an
  // explicitly built worker artifact. Packaged Desktop passes this option at
  // its own composition boundary and does not depend on this environment hook.
  const agentWorkerScript = process.env.PIWIN_AGENT_WORKER_SCRIPT?.trim();
  if (agentWorkerScript) {
    runtimeOptions.agentWorkerScript = resolve(agentWorkerScript);
  }
  if (testFixture !== undefined) {
    runtimeOptions.testFixture = testFixture;
  }
  if (permissionModeOverride !== undefined) {
    runtimeOptions.permissionModeOverride = permissionModeOverride;
  }
  const clientToolBroker = await createDeviceToolBrokerForHost(hostDataRoot);
  if (clientToolBroker !== undefined) {
    runtimeOptions.clientToolExecution = clientToolBroker;
  }
  const runtime = new HostRuntime(runtimeOptions);
  const authority = createSidecarHostAuthority(runtime);
  authority.start();
  const egressHub = authority.egressHub;
  const egressChannel = egressHub.addClient({
    id: LOCAL_JSONL_CLIENT_ID,
    initialSeq: 0,
    supportsBatch: true,
    canSend: () => transport.canAcceptPush(),
    ...HOST_SERVE_LOCAL_EGRESS_LIMITS,
    send: (message) => {
      const localMessage = message.type === 'push/batch' ? message : message.push;
      void transport.send(localMessage).catch((error: unknown) => {
        console.error(
          `[piwin host serve] egress write failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      });
    },
    onSlowConsumer: (reason) => {
      console.error(`[piwin host serve] local egress closed: ${reason}`);
    },
  });

  egressHub.ingest({
    type: 'host/status',
    mode: runtime.getMode(),
    ready: true,
    mock,
  });

  // ADR 0015: control-lane commands (abort, permission resolve, …) bypass
  // the serialized mutation queue so Stop can reach an in-flight turn.
  // ADR 0027: dispatcher is transport-agnostic — it takes a `send` function,
  // so a future WebSocketTransport/GatewayDialTransport reuses it unchanged.
  const dispatcher = createHostServeDispatcher({
    runtime,
    send: (message) => transport.send(message),
    commandTimeoutMs: 45_000,
    admit: (request, execute) =>
      admitAndExecuteHostCommand({
        registry: authority.idempotencyRegistry,
        principalId: request.clientPrincipalId ?? LOCAL_JSONL_CLIENT_ID,
        idempotencyKey: request.idempotencyKey,
        command: request.command,
        execute,
      }),
  });
  const hostInstanceId = authority.hostInstanceId;
  let mobileAccess: Awaited<ReturnType<typeof createSidecarMobileAccess>> | undefined;
  try {
    mobileAccess = await createSidecarMobileAccess({
      runtime,
      instanceId: hostInstanceId,
      piwinRoot: hostDataRoot,
      egressHub,
      idempotencyRegistry: authority.idempotencyRegistry,
      ...(clientToolBroker === undefined ? {} : { clientToolBroker }),
    });
  } catch (error) {
    console.error(
      `[piwin host serve] phone-access store unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) {
      return shutdownPromise;
    }
    shutdownPromise = (async (): Promise<void> => {
      // Stop reading first so EOF and SIGINT cannot admit more commands while
      // the existing command and stream work is being drained.
      await transport.stop();
      await dispatcher.drain();
      await mobileAccess?.dispose();
      egressHub.flush();
      egressChannel.flushNow();
      authority.dispose();
      await runtime.dispose();
    })();
    return shutdownPromise;
  };

  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });

  await transport.start((request) => {
    void interceptSidecarMobileAccess(mobileAccess, request.command, (message) =>
      transport.send(message),
    ).then((handled) => {
      if (!handled) {
        dispatcher.dispatch(request);
      }
    });
  });

  await shutdown();
}
