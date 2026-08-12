import { access, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openSessionTranscriptStore, saveSessionTranscript } from '@piwin/session';
import {
  getPiwinSessionTranscriptBackupPath,
  getPiwinSessionTranscriptDatabasePath,
  getPiwinSessionTranscriptPath,
} from './paths.js';
import {
  createSessionTranscriptStoreRegistry,
  InterruptedTranscriptMigrationError,
  listInterruptedTranscriptMigrations,
  repairInterruptedTranscriptMigration,
} from './session-transcript-store-registry.js';

describe('SessionTranscriptStoreRegistry', () => {
  it('imports legacy JSON, verifies SQLite, and retains a backup', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-registry-'));
    const sessionId = 'legacy-session';
    await saveSessionTranscript(getPiwinSessionTranscriptPath(rootDir, sessionId), {
      version: 1,
      sessionId,
      projectPath: '/project',
      messages: [
        {
          id: 'legacy-user',
          role: 'user',
          text: 'legacy body',
          createdAt: '2026-08-09T00:00:00.000Z',
          status: 'done',
        },
      ],
      updatedAt: '2026-08-09T00:00:00.000Z',
    });
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    const store = await registry.get(sessionId, '/project');
    expect(await store.isMigrated()).toBe(true);
    expect((await store.getMessage('legacy-user'))?.text).toBe('legacy body');
    expect((await stat(getPiwinSessionTranscriptBackupPath(rootDir, sessionId))).isFile()).toBe(
      true,
    );
    registry.closeAll();
  });

  it('marks a fresh Store authoritative and closes handles on eviction', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-fresh-'));
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    const first = await registry.get('fresh', '/project');
    expect(await first.isMigrated()).toBe(true);
    registry.close('fresh');
    await expect(first.count()).rejects.toThrow(/closed/);
    const reopened = await registry.get('fresh', '/project');
    expect(await reopened.isMigrated()).toBe(true);
    registry.closeAll();
  });

  it('keeps a shared cold handle until every concurrent command lease exits', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-lease-'));
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let firstStore: Awaited<ReturnType<typeof registry.get>> | undefined;
    let secondStore: Awaited<ReturnType<typeof registry.get>> | undefined;
    const firstLease = registry.withCommandLease(
      async () => {
        firstStore = await registry.get('shared-cold', '/project');
        await firstGate;
      },
      () => false,
    );
    const secondLease = registry.withCommandLease(
      async () => {
        secondStore = await registry.get('shared-cold', '/project');
        await secondGate;
      },
      () => false,
    );
    await vi.waitFor(() => {
      expect(firstStore).toBeDefined();
      expect(secondStore).toBe(firstStore);
    });
    releaseFirst?.();
    await firstLease;
    expect(await secondStore?.count()).toBe(0);
    releaseSecond?.();
    await secondLease;
    await expect(secondStore?.count()).rejects.toThrow(/closed/);
    registry.closeAll();
  });

  it('defers an eviction close until the active command lease exits', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-eviction-lease-'));
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    let releaseLease: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLease = resolve;
    });
    let leasedStore: Awaited<ReturnType<typeof registry.get>> | undefined;
    const lease = registry.withCommandLease(
      async () => {
        leasedStore = await registry.get('resident-export', '/project');
        await gate;
      },
      () => true,
    );
    await vi.waitFor(() => expect(leasedStore).toBeDefined());

    registry.close('resident-export');
    expect(await leasedStore?.count()).toBe(0);

    releaseLease?.();
    await lease;
    await expect(leasedStore?.count()).rejects.toThrow(/closed/);
    registry.closeAll();
  });

  it('closes a one-shot cold Store immediately after its operation', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-one-shot-'));
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    let leasedStore: Awaited<ReturnType<typeof registry.get>> | undefined;
    const count = await registry.withStore(
      'one-shot',
      '/project',
      async (store) => {
        leasedStore = store;
        return store.count();
      },
      () => false,
    );
    expect(count).toBe(0);
    await expect(leasedStore?.count()).rejects.toThrow(/closed/);
    registry.closeAll();
  });

  it('rejects a try-maintenance lease while a command owns the Store', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-maintenance-busy-'));
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    let releaseCommand: (() => void) | undefined;
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    let storeReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      storeReady = resolve;
    });
    const command = registry.withCommandLease(
      async () => {
        await registry.get('maintenance-busy', '/project');
        storeReady?.();
        await commandGate;
      },
      () => true,
    );
    await ready;

    await expect(
      registry.tryWithMaintenanceLease('maintenance-busy', async () => 'unexpected'),
    ).resolves.toEqual({ acquired: false });

    releaseCommand?.();
    await command;
    registry.closeAll();
  });

  it('blocks new Store access while maintenance owns the session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-maintenance-lock-'));
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    const sessionId = 'maintenance-lock';
    await registry.withMaintenanceLease(sessionId, async () => {
      await expect(registry.get(sessionId, '/project')).rejects.toThrow(/under maintenance/);
    });
    await expect(access(getPiwinSessionTranscriptDatabasePath(rootDir, sessionId))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
    registry.closeAll();
  });

  it('serializes concurrent maintenance operations for the same session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-maintenance-queue-'));
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const first = registry.withMaintenanceLease('maintenance-queue', async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
    });
    const second = registry.withMaintenanceLease('maintenance-queue', async () => {
      order.push('second-start');
      order.push('second-end');
    });

    await vi.waitFor(() => expect(order).toEqual(['first-start']));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
    registry.closeAll();
  });

  it('rejects queued maintenance after the registry closes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-maintenance-close-'));
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const first = registry.withMaintenanceLease('maintenance-close', async () => {
      firstStarted?.();
      await firstGate;
    });
    const queued = registry.withMaintenanceLease('maintenance-close', async () => 'unexpected');
    await started;
    registry.closeAll();
    releaseFirst?.();

    await expect(first).resolves.toBeUndefined();
    await expect(queued).rejects.toThrow(/closed/);
  });

  it('fails closed when an existing database cannot verify the legacy source', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-interrupted-'));
    const sessionId = 'interrupted';
    const direct = await openSessionTranscriptStore({
      dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
      sessionId,
      projectPath: '/project',
    });
    await direct.appendMessage({
      id: 'unexpected-live-row',
      runtimeGenerationId: 'live-before-migration',
      backendMessageId: 'backend-1',
      role: 'assistant',
      text: 'partial database',
      status: 'done',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    direct.close();
    await saveSessionTranscript(getPiwinSessionTranscriptPath(rootDir, sessionId), {
      version: 1,
      sessionId,
      projectPath: '/project',
      messages: [],
      updatedAt: '2026-08-09T00:00:00.000Z',
    });
    const registry = createSessionTranscriptStoreRegistry({ rootDir });
    await expect(registry.get(sessionId, '/project')).rejects.toBeInstanceOf(
      InterruptedTranscriptMigrationError,
    );
    expect((await stat(getPiwinSessionTranscriptBackupPath(rootDir, sessionId))).isFile()).toBe(
      true,
    );
    expect(
      (await listInterruptedTranscriptMigrations(rootDir)).map((issue) => issue.sessionId),
    ).toEqual([sessionId]);
    const repaired = await repairInterruptedTranscriptMigration(rootDir, sessionId);
    expect(repaired.repaired).toBe(true);
    if (repaired.previousDatabasePath === undefined) {
      throw new Error('expected interrupted database backup path');
    }
    expect((await stat(repaired.previousDatabasePath)).isFile()).toBe(true);
    expect(await listInterruptedTranscriptMigrations(rootDir)).toEqual([]);
    const recovered = await registry.get(sessionId, '/project');
    expect(await recovered.isMigrated()).toBe(true);
    expect(await recovered.count()).toBe(0);
    registry.closeAll();
  });
});
