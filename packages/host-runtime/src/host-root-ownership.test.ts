import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HostRuntime } from './host-runtime.js';
import { PiwinRootAlreadyOwnedError } from './piwin-root-lease.js';

function createOwnedRuntime(rootDir: string): HostRuntime {
  return new HostRuntime({
    mode: 'sdk',
    mock: true,
    piwinRoot: rootDir,
    rootOwnership: { enabled: true, ownerKind: 'test' },
  });
}

describe('HostRuntime root ownership', () => {
  it('rejects a second Host for the same root and releases on dispose', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-ownership-'));

    const first = createOwnedRuntime(rootDir);
    try {
      expect(first.getHostInstanceId()).not.toBe('');
      expect(() => createOwnedRuntime(rootDir)).toThrow(PiwinRootAlreadyOwnedError);
    } finally {
      await first.dispose();
    }

    // The released root can be owned again by the next Host.
    const replacement = createOwnedRuntime(rootDir);
    await replacement.dispose();
  });

  it('records the owning Host instance id in the owner token', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-owner-record-'));

    const runtime = createOwnedRuntime(rootDir);
    try {
      const owner = JSON.parse(
        await readFile(join(rootDir, '.host', 'owner.lock', 'owner.json'), 'utf8'),
      ) as { hostInstanceId: string };
      expect(owner.hostInstanceId).toBe(runtime.getHostInstanceId());
    } finally {
      await runtime.dispose();
    }
  });
});
