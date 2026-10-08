import { resolveHostDataRoot } from './host-data-root.js';
import { installHostDiagnosticLog } from './host-diagnostic-log.js';
import { createHostServeDispatcher } from './host-serve-dispatcher.js';
import {
  HOST_SERVE_LOCAL_EGRESS_LIMITS,
  createJsonlStdioTransport,
} from './host-serve-transport.js';
import { interceptSidecarLocalShellAccess } from './local-shell-access-serve.js';
import { createSidecarMobileAccess, interceptSidecarMobileAccess } from './mobile-access-serve.js';
import { LOCAL_JSONL_CLIENT_ID, createSidecarHostAuthority } from './sidecar-host-authority.js';
import { attachSidecarLocalEgress } from './sidecar-local-egress.js';
import { HostRuntime, applyPiwinPlaywrightBrowsersPath } from '@piwin/host-runtime';
import {
  LocalShellAccess,
  admitAndExecuteHostCommand,
  createDeviceToolBrokerForHost,
} from '@piwin/host-server';
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
  runtimeOptions.clientToolExecution = clientToolBroker;
  const runtime = new HostRuntime(runtimeOptions);
  const authority = createSidecarHostAuthority(runtime);
  authority.start();
  const egressHub = authority.egressHub;
  const ingestHostStatus = (): void => {
    egressHub.ingest({
      type: 'host/status',
      mode: runtime.getMode(),
      ready: true,
      mock,
    });
  };
  const localEgress = attachSidecarLocalEgress({
    egressHub,
    clientId: LOCAL_JSONL_CLIENT_ID,
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
    log: (line) => console.error(line),
    // A fresh control push makes the re-attach gap visible to Desktop now,
    // not only when the next Run event happens to arrive.
    onReattached: ingestHostStatus,
  });

  ingestHostStatus();

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
      clientToolBroker,
    });
    // Phone access is on by default; reopen the LAN listener without waiting on
    // it. resume() reports its own failures (status.lastError + stderr). Mock
    // sidecars (tests, demos) never open a network listener on their own.
    if (!mock) {
      void mobileAccess.resume();
    }
  } catch (error) {
    console.error(
      `[piwin host serve] phone-access store unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  // Entrance for shells on this machine (the TUI in a Desktop pane). Nothing
  // listens until Desktop asks for it.
  const localShellAccess = new LocalShellAccess({
    runtime,
    instanceId: hostInstanceId,
    piwinRoot: hostDataRoot,
    egressHub,
    idempotencyRegistry: authority.idempotencyRegistry,
    clientToolBroker,
    onError: (error) => {
      console.error(`[piwin host serve] local-shell-access error: ${error.message}`);
    },
  });

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
      await localShellAccess.dispose();
      egressHub.flush();
      localEgress.flushNow();
      localEgress.dispose();
      authority.dispose();
      await runtime.dispose();
    })();
    return shutdownPromise;
  };

  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });

  await transport.start((request) => {
    const send = (message: Parameters<typeof transport.send>[0]): Promise<void> => transport.send(message);
    void (async (): Promise<void> => {
      const handled =
        (await interceptSidecarMobileAccess(mobileAccess, request.command, send)) ||
        (await interceptSidecarLocalShellAccess(localShellAccess, request.command, send));
      if (!handled) {
        dispatcher.dispatch(request);
      }
    })();
  });

  await shutdown();
}
