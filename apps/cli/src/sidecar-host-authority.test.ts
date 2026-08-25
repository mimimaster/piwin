import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HostRuntime } from '@piwin/host-runtime';
import { HostServer } from '@piwin/host-server';
import { createSidecarHostAuthority } from './sidecar-host-authority.js';

describe('sidecar host authority', () => {
  it('exposes one runtime identity and one production sink for JSONL plus phone-access', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-sidecar-authority-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      rootOwnership: { enabled: false },
    });
    const authority = createSidecarHostAuthority(runtime);
    try {
      authority.start();
      expect(authority.hostInstanceId).toBe(runtime.getHostInstanceId());
      expect(runtime.countProductionPushSinks()).toBe(1);
      const server = new HostServer({
        runtime,
        port: 0,
        instanceId: authority.hostInstanceId,
        egressHub: authority.egressHub,
        idempotencyRegistry: authority.idempotencyRegistry,
      });
      await server.start();
      expect(server.getInstanceId()).toBe(authority.hostInstanceId);
      expect(runtime.countProductionPushSinks()).toBe(1);
      await server.stop();
      expect(authority.egressHub.getHostInstanceId()).toBe(authority.hostInstanceId);
      expect(runtime.countProductionPushSinks()).toBe(1);
    } finally {
      authority.dispose();
      await runtime.dispose();
    }
  });
});
