import {
  HostCommandIdempotencyRegistry,
  HostEgressHub,
} from '@piwin/host-server';
import type { HostRuntime } from '@piwin/host-runtime';

const LOCAL_JSONL_CLIENT_ID = 'local-jsonl';

export type SidecarHostAuthority = {
  hostInstanceId: string;
  egressHub: HostEgressHub;
  idempotencyRegistry: HostCommandIdempotencyRegistry;
  start(): void;
  dispose(): void;
};

/** One identity, one hub, one idempotency table for sidecar JSONL + phone-access. */
export function createSidecarHostAuthority(runtime: HostRuntime): SidecarHostAuthority {
  const hostInstanceId = runtime.getHostInstanceId();
  const idempotencyRegistry = new HostCommandIdempotencyRegistry();
  const egressHub = new HostEgressHub({
    hostInstanceId,
    attachRuntimeSink: (sink) => runtime.attachPushSink(sink),
    maxClientQueueItems: 4_096,
    maxClientQueueBytes: 8 * 1024 * 1024,
    onError: (error) => console.error(`[piwin host serve] egress error: ${error.message}`),
  });
  return {
    hostInstanceId,
    egressHub,
    idempotencyRegistry,
    start() {
      egressHub.start();
    },
    dispose() {
      egressHub.dispose();
      idempotencyRegistry.dispose();
    },
  };
}

export { LOCAL_JSONL_CLIENT_ID };
