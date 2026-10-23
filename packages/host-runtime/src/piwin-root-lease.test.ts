import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  acquirePiwinRootLease,
  PiwinRootAlreadyOwnedError,
  PiwinRootLeaseCompromisedError,
  PiwinRootOwnershipUnknownError,
  type PiwinRootOwner,
} from './piwin-root-lease.js';

function createOwner(processId: number): PiwinRootOwner {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    leaseId: randomUUID(),
    hostInstanceId: randomUUID(),
    processId,
    processStartedAt: now,
    acquiredAt: now,
    ownerKind: 'test',
  };
}

async function writeExistingOwner(rootDir: string, owner: PiwinRootOwner): Promise<void> {
  const lockDir = join(rootDir, '.host', 'owner.lock');
  await mkdir(lockDir, { recursive: true, mode: 0o700 });
  await writeFile(join(lockDir, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

describe('piwin root lease', () => {
  it('allows one owner and rejects another live owner', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-lease-live-'));
    const firstLease = acquirePiwinRootLease({ rootDir, ownerKind: 'test' });

    try {
      expect(() => acquirePiwinRootLease({ rootDir, ownerKind: 'test' })).toThrow(
        PiwinRootAlreadyOwnedError,
      );
    } finally {
      firstLease.release();
    }

    const replacementLease = acquirePiwinRootLease({ rootDir, ownerKind: 'test' });
    replacementLease.release();
  });

  it('canonicalizes symlink aliases to the same ownership lock', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-lease-real-'));
    const aliasParent = await mkdtemp(join(tmpdir(), 'piwin-root-lease-alias-'));
    const aliasPath = join(aliasParent, 'root-link');
    await symlink(rootDir, aliasPath, 'dir');

    const lease = acquirePiwinRootLease({ rootDir, ownerKind: 'test' });
    try {
      expect(() => acquirePiwinRootLease({ rootDir: aliasPath, ownerKind: 'test' })).toThrow(
        PiwinRootAlreadyOwnedError,
      );
    } finally {
      lease.release();
    }
  });

  it('reclaims a strictly valid owner whose process is provably dead', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-lease-dead-'));
    const deadProcessId = 2_147_483_647;
    await writeExistingOwner(rootDir, createOwner(deadProcessId));

    const lease = acquirePiwinRootLease({ rootDir, ownerKind: 'test' });
    try {
      expect(lease.owner.processId).toBe(process.pid);
      const persistedOwner = JSON.parse(
        await readFile(join(rootDir, '.host', 'owner.lock', 'owner.json'), 'utf8'),
      ) as PiwinRootOwner;
      expect(persistedOwner.leaseId).toBe(lease.owner.leaseId);
    } finally {
      lease.release();
    }
  });

  it('reclaims a lock whose PID now belongs to a different process', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-lease-reused-'));
    // A live PID (ours) but a record from a process that started a day ago:
    // after a reboot the number went to someone else.
    const staleOwner = {
      ...createOwner(process.pid),
      processStartedAt: new Date(Date.now() - 86_400_000).toISOString(),
    };
    await writeExistingOwner(rootDir, staleOwner);

    const lease = acquirePiwinRootLease({
      rootDir,
      ownerKind: 'test',
      inspectOwnerProcess: () => ({ parentProcessId: 1, elapsedMs: 60_000, command: 'login-item' }),
    });
    try {
      expect(lease.owner.leaseId).not.toBe(staleOwner.leaseId);
    } finally {
      lease.release();
    }
  });

  it('reclaims a lock whose live PID runs a different executable', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-lease-exec-'));
    const owner = { ...createOwner(process.pid), processExecPath: '/opt/piwin/piwin-host' };
    await writeExistingOwner(rootDir, owner);

    const lease = acquirePiwinRootLease({
      rootDir,
      ownerKind: 'test',
      inspectOwnerProcess: () => ({ parentProcessId: 1, elapsedMs: 0, command: '/usr/bin/vim' }),
    });
    lease.release();
  });

  it('keeps rejecting a live owner whose identity matches', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-lease-same-'));
    const owner = { ...createOwner(process.pid), processExecPath: '/opt/piwin/piwin-host' };
    await writeExistingOwner(rootDir, owner);

    expect(() =>
      acquirePiwinRootLease({
        rootDir,
        ownerKind: 'test',
        inspectOwnerProcess: () => ({
          parentProcessId: 42,
          elapsedMs: 0,
          command: '/opt/piwin/piwin-host host-serve.mjs host serve',
        }),
      }),
    ).toThrow(PiwinRootAlreadyOwnedError);
  });

  it('records its own executable for later identity checks', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-lease-record-'));
    const lease = acquirePiwinRootLease({ rootDir, ownerKind: 'test' });
    try {
      expect(lease.owner.processExecPath).toBe(process.execPath);
    } finally {
      lease.release();
    }
  });

  it('fails closed when an existing owner record is malformed', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-lease-malformed-'));
    const lockDir = join(rootDir, '.host', 'owner.lock');
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, 'owner.json'), '{not-json', 'utf8');

    expect(() => acquirePiwinRootLease({ rootDir, ownerKind: 'test' })).toThrow(
      PiwinRootOwnershipUnknownError,
    );
  });

  it('does not remove a lock whose ownership token changed', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-root-lease-token-'));
    const compromised = vi.fn();
    const lease = acquirePiwinRootLease({
      rootDir,
      ownerKind: 'test',
      heartbeatIntervalMs: 60_000,
      onCompromised: compromised,
    });
    const replacementOwner = createOwner(process.pid);
    await writeFile(
      join(rootDir, '.host', 'owner.lock', 'owner.json'),
      `${JSON.stringify(replacementOwner, null, 2)}\n`,
      'utf8',
    );

    expect(() => lease.release()).toThrow(PiwinRootLeaseCompromisedError);
    expect(compromised).toHaveBeenCalledTimes(1);

    const persistedOwner = JSON.parse(
      await readFile(join(rootDir, '.host', 'owner.lock', 'owner.json'), 'utf8'),
    ) as PiwinRootOwner;
    expect(persistedOwner.leaseId).toBe(replacementOwner.leaseId);
  });
});
