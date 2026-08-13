import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hasForeignLiveSessionRuntime,
  registerSessionRuntimeLease,
  releaseSessionRuntimeLease,
  tryWithSessionOperationLock,
  withSessionOperationLock,
} from './session-runtime-lease.js';

describe('session runtime lease coordination', () => {
  it('reports live foreign owners and ignores the caller owner', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-runtime-lease-'));
    await registerSessionRuntimeLease({
      rootDir,
      sessionId: 'session-a',
      owner: { ownerId: 'desktop', pid: process.pid },
    });

    await expect(
      hasForeignLiveSessionRuntime({
        rootDir,
        sessionId: 'session-a',
        ownerId: 'cli',
      }),
    ).resolves.toBe(true);
    await expect(
      hasForeignLiveSessionRuntime({
        rootDir,
        sessionId: 'session-a',
        ownerId: 'desktop',
      }),
    ).resolves.toBe(false);

    await releaseSessionRuntimeLease({
      rootDir,
      sessionId: 'session-a',
      ownerId: 'desktop',
    });
    await expect(
      hasForeignLiveSessionRuntime({
        rootDir,
        sessionId: 'session-a',
        ownerId: 'cli',
      }),
    ).resolves.toBe(false);
  });

  it('makes try-lock fail while another session operation owns the lock', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-operation-lock-'));
    let releaseOwner: (() => void) | undefined;
    const ownerGate = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });
    let ownerStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      ownerStarted = resolve;
    });
    const owner = withSessionOperationLock({
      rootDir,
      sessionId: 'session-b',
      operation: async () => {
        ownerStarted?.();
        await ownerGate;
      },
    });
    await started;

    const contender = await tryWithSessionOperationLock({
      rootDir,
      sessionId: 'session-b',
      operation: async () => 'unexpected',
    });
    expect(contender).toEqual({ acquired: false });

    releaseOwner?.();
    await owner;
  });

  it('rejects traversal session ids before touching disk', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-runtime-lease-path-'));
    await expect(
      registerSessionRuntimeLease({
        rootDir,
        sessionId: '../escape',
        owner: { ownerId: 'owner', pid: process.pid },
      }),
    ).rejects.toThrow(/separators/);
  });

  it('treats a live PID with a stale heartbeat as abandoned', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-runtime-lease-stale-'));
    const staleIso = new Date(Date.now() - 10 * 60_000).toISOString();
    await registerSessionRuntimeLease({
      rootDir,
      sessionId: 'session-stale',
      owner: {
        ownerId: 'foreign-host',
        pid: process.pid,
        startedAt: staleIso,
        updatedAt: staleIso,
      },
    });
    // registerSessionRuntimeLease always writes a fresh updatedAt; overwrite
    // the on-disk heartbeat to simulate an abandoned owner with a reused PID.
    const { readFile, writeFile } = await import('node:fs/promises');
    const leasePath = join(rootDir, 'runtime-leases', 'session-stale', 'foreign-host.json');
    const parsed = JSON.parse(await readFile(leasePath, 'utf8')) as Record<string, unknown>;
    await writeFile(
      leasePath,
      `${JSON.stringify({ ...parsed, startedAt: staleIso, updatedAt: staleIso })}\n`,
      'utf8',
    );

    await expect(
      hasForeignLiveSessionRuntime({
        rootDir,
        sessionId: 'session-stale',
        ownerId: 'local-host',
      }),
    ).resolves.toBe(false);
  });

  it('keeps a fresh foreign lease visible to other owners', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-runtime-lease-fresh-'));
    await registerSessionRuntimeLease({
      rootDir,
      sessionId: 'session-fresh',
      owner: {
        ownerId: 'foreign-host',
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
    });

    await expect(
      hasForeignLiveSessionRuntime({
        rootDir,
        sessionId: 'session-fresh',
        ownerId: 'local-host',
      }),
    ).resolves.toBe(true);
  });

  it('breaks an operation lock whose live PID predates any real operation', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-operation-lock-stale-'));
    const { mkdir, writeFile } = await import('node:fs/promises');
    const locksDir = join(rootDir, 'locks', 'session-operations');
    await mkdir(locksDir, { recursive: true });

    // A crashed Host left a lock; the OS later reused its PID for a
    // long-lived unrelated process. The pid is alive but the createdAt is far
    // older than any legitimate operation, so the lock must be broken.
    const staleIso = new Date(Date.now() - 20 * 60_000).toISOString();
    await writeFile(
      join(locksDir, 'session-pid-reuse.lock'),
      `${JSON.stringify({ pid: process.pid, createdAt: staleIso, token: 'crashed-owner' })}\n`,
      'utf8',
    );

    const contender = await tryWithSessionOperationLock({
      rootDir,
      sessionId: 'session-pid-reuse',
      operation: async () => 'acquired',
    });
    expect(contender).toEqual({ acquired: true, value: 'acquired' });
  });

  it('does not remove a newer owner lock when a stale-broken owner releases', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-operation-lock-token-'));
    const { mkdir, readFile, writeFile } = await import('node:fs/promises');
    const locksDir = join(rootDir, 'locks', 'session-operations');
    await mkdir(locksDir, { recursive: true });
    const lockPath = join(locksDir, 'session-token.lock');

    let releaseOwner: (() => void) | undefined;
    const ownerGate = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });
    let ownerStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      ownerStarted = resolve;
    });
    const owner = withSessionOperationLock({
      rootDir,
      sessionId: 'session-token',
      operation: async () => {
        ownerStarted?.();
        await ownerGate;
      },
    });
    await started;

    // Simulate the owner's lock being stale-broken and replaced by another
    // process. The old owner's release must not delete the new lock.
    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: 'new-owner' })}\n`,
      'utf8',
    );

    releaseOwner?.();
    await owner;

    const remaining = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: unknown };
    expect(remaining.token).toBe('new-owner');
  });
});
