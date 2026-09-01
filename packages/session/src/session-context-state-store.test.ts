import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  createUnknownSessionContextSnapshot,
  type AssistantUsageMeasurement,
  type ContextBoundary,
  type SessionContextSnapshot,
} from '@piwin/contracts';
import {
  openSessionTranscriptStore,
  seedDerivedSessionContextState,
  type SessionTranscriptStore,
} from './index.js';

async function openStore(label: string): Promise<{
  store: SessionTranscriptStore;
  dbPath: string;
  sessionId: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), `piwin-context-state-${label}-`));
  const dbPath = join(rootDir, 'transcript.sqlite3');
  const sessionId = `session-${label}`;
  const store = await openSessionTranscriptStore({
    dbPath,
    sessionId,
    projectPath: '/tmp/project',
  });
  return { store, dbPath, sessionId };
}

function boundary(activeLeafMessageId: string | null = null): ContextBoundary {
  return { activeLeafMessageId };
}

function unknownSnapshot(
  sessionId: string,
  overrides: Partial<SessionContextSnapshot> = {},
): SessionContextSnapshot {
  return {
    ...createUnknownSessionContextSnapshot({
      sessionId,
      revision: 1,
      contextVersion: 1,
      contextBoundary: boundary('leaf-a'),
      reason: 'test-unknown',
      updatedAt: '2026-08-30T00:00:00.000Z',
    }),
    ...overrides,
  };
}

function knownOccupancy(tokensUsed: number) {
  return {
    kind: 'known' as const,
    tokensUsed,
    tokensLimit: 128_000,
    quality: 'measured' as const,
    coverage: 'complete' as const,
    basis: 'current-request',
    sampledAt: '2026-08-30T00:00:00.000Z',
  };
}

describe('session context state store', () => {
  it('creates context tables idempotently when opening twice', async () => {
    const { dbPath, sessionId, store } = await openStore('migrate');
    expect(await store.readContextState()).toBeNull();
    store.close();
    const again = await openSessionTranscriptStore({
      dbPath,
      sessionId,
      projectPath: '/tmp/project',
    });
    expect(await again.readContextState()).toBeNull();
    const db = new DatabaseSync(dbPath);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(['session_context_state', 'assistant_usage_measurement']),
    );
    db.close();
    again.close();
  });

  it('CAS rejects a stale contextVersion or a different boundary and does not bump revision', async () => {
    const { store, sessionId } = await openStore('cas');
    const first = await store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: boundary('leaf-a'),
      snapshot: unknownSnapshot(sessionId, { contextVersion: 1 }),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected insert');
    expect(first.snapshot.revision).toBe(1);

    const advanced = await store.replaceContextState({
      expectedContextVersion: first.snapshot.contextVersion,
      expectedBoundary: boundary('leaf-a'),
      snapshot: unknownSnapshot(sessionId, {
        contextVersion: 2,
        occupancy: { kind: 'unknown', reason: 'advanced' },
      }),
    });
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) throw new Error('expected version bump');
    expect(advanced.snapshot.revision).toBe(2);

    const staleVersion = await store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: boundary('leaf-a'),
      snapshot: unknownSnapshot(sessionId, { contextVersion: 3, occupancy: { kind: 'unknown', reason: 'stale' } }),
    });
    expect(staleVersion).toEqual({ ok: false, reason: 'cas-mismatch' });

    const differentBoundary = await store.replaceContextState({
      expectedContextVersion: 2,
      expectedBoundary: boundary('leaf-b'),
      snapshot: unknownSnapshot(sessionId, { contextVersion: 2, contextBoundary: boundary('leaf-b') }),
    });
    expect(differentBoundary).toEqual({ ok: false, reason: 'cas-mismatch' });
    expect((await store.readContextState())?.revision).toBe(2);
    store.close();
  });

  it('does not bump revision when a write is unavailable, and close/reopen keeps the committed revision', async () => {
    const { store, dbPath, sessionId } = await openStore('revision');
    const first = await store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: boundary('leaf-a'),
      snapshot: unknownSnapshot(sessionId),
    });
    expect(first.ok).toBe(true);
    store.close();
    const closedWrite = await store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: boundary('leaf-a'),
      snapshot: unknownSnapshot(sessionId, { contextVersion: 2 }),
    });
    expect(closedWrite).toEqual({ ok: false, reason: 'unavailable' });

    const reopened = await openSessionTranscriptStore({
      dbPath,
      sessionId,
      projectPath: '/tmp/project',
    });
    const restored = await reopened.readContextState();
    expect(restored?.revision).toBe(1);
    expect(restored?.contextVersion).toBe(1);
    reopened.close();
  });

  it('putAssistantUsageMeasurement is idempotent on measurementId', async () => {
    const { store, sessionId } = await openStore('usage');
    await store.appendMessage({
      id: 'msg-1',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'b-1',
      role: 'assistant',
      text: 'hello',
      status: 'done',
      createdAt: '2026-08-30T00:00:00.000Z',
    });
    const measurement: AssistantUsageMeasurement = {
      measurementId: `${sessionId}:gen-1:msg-1`,
      sessionId,
      messageId: 'msg-1',
      totalTokens: 9,
      recordedAt: '2026-08-30T00:00:01.000Z',
    };
    expect(await store.putAssistantUsageMeasurement(measurement)).toBe('inserted');
    expect(await store.putAssistantUsageMeasurement({ ...measurement, totalTokens: 99 })).toBe(
      'duplicate',
    );
    expect(await store.readLatestAssistantUsageForActivePath()).toEqual(measurement);
    store.close();
  });

  it('derived sessions rewrite context state without copying live runId or revision', async () => {
    const source = await openStore('derive-src');
    const target = await openStore('derive-dst');
    const inserted = await source.store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: boundary('leaf-a'),
      snapshot: {
        ...unknownSnapshot(source.sessionId, {
          runId: 'run-live',
          runtimeGenerationId: 'gen-live',
          contextVersion: 7,
          responseEvidence: {
            currentRunHasResponse: true,
            historyHasDisplayableResponse: true,
            evidenceMessageId: 'msg-live',
          },
        }),
      },
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) throw new Error('expected source snapshot');
    expect(inserted.snapshot.revision).toBe(1);
    await source.store.replaceContextState({
      expectedContextVersion: 7,
      expectedBoundary: boundary('leaf-a'),
      snapshot: {
        ...inserted.snapshot,
        occupancy: { kind: 'unknown', reason: 'second-write' },
      },
    });

    await seedDerivedSessionContextState({
      source: source.store,
      target: target.store,
      targetSessionId: target.sessionId,
      updatedAt: '2026-08-30T00:01:00.000Z',
    });
    const derived = await target.store.readContextState();
    expect(derived?.sessionId).toBe(target.sessionId);
    expect(derived?.revision).toBe(1);
    expect(derived?.contextVersion).toBe(1);
    expect(derived?.runId).toBeUndefined();
    expect(derived?.runtimeGenerationId).toBeUndefined();
    expect(derived?.responseEvidence.currentRunHasResponse).toBe(false);
    expect(derived?.responseEvidence.historyHasDisplayableResponse).toBe(true);
    expect(derived?.occupancy).toEqual({ kind: 'unknown', reason: 'derived-session' });
    source.store.close();
    target.store.close();
  });

  it('keeps derived occupancy unknown when the source snapshot is known', async () => {
    const source = await openStore('derive-occ-src');
    const target = await openStore('derive-occ-dst');
    const occupancy = knownOccupancy(12_400);
    const inserted = await source.store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: boundary('leaf-a'),
      snapshot: unknownSnapshot(source.sessionId, {
        occupancy,
        lastConfirmed: {
          occupancy,
          contextBoundary: boundary('leaf-a'),
          sampledAt: '2026-08-30T00:00:00.000Z',
        },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
        phase: 'idle',
      }),
    });
    expect(inserted.ok).toBe(true);

    await seedDerivedSessionContextState({
      source: source.store,
      target: target.store,
      targetSessionId: target.sessionId,
      updatedAt: '2026-08-30T00:01:00.000Z',
    });
    const derived = await target.store.readContextState();
    expect(derived?.occupancy).toEqual({ kind: 'unknown', reason: 'derived-session' });
    expect(derived?.lastConfirmed).toBeUndefined();
    expect(derived?.sessionId).toBe(target.sessionId);
    expect(derived?.runId).toBeUndefined();
    expect(derived?.responseEvidence.historyHasDisplayableResponse).toBe(true);
    source.store.close();
    target.store.close();
  });

  it('keeps derived occupancy unknown when the source only has lastConfirmed', async () => {
    const source = await openStore('derive-last-src');
    const target = await openStore('derive-last-dst');
    const occupancy = knownOccupancy(8_800);
    const inserted = await source.store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: boundary('leaf-a'),
      snapshot: unknownSnapshot(source.sessionId, {
        occupancy: { kind: 'unknown', reason: 'waiting-for-response' },
        lastConfirmed: {
          occupancy,
          contextBoundary: boundary('leaf-a'),
          sampledAt: '2026-08-30T00:00:00.000Z',
        },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
        phase: 'idle',
      }),
    });
    expect(inserted.ok).toBe(true);

    await seedDerivedSessionContextState({
      source: source.store,
      target: target.store,
      targetSessionId: target.sessionId,
      updatedAt: '2026-08-30T00:01:00.000Z',
    });
    const derived = await target.store.readContextState();
    expect(derived?.occupancy).toEqual({ kind: 'unknown', reason: 'derived-session' });
    expect(derived?.lastConfirmed).toBeUndefined();
    source.store.close();
    target.store.close();
  });

  it('keeps derived occupancy unknown when the target active leaf is truncated', async () => {
    const source = await openStore('derive-trunc-src');
    const target = await openStore('derive-trunc-dst');
    const occupancy = knownOccupancy(12_400);
    const inserted = await source.store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: boundary('a2'),
      snapshot: unknownSnapshot(source.sessionId, {
        occupancy,
        lastConfirmed: {
          occupancy,
          contextBoundary: boundary('a2'),
          sampledAt: '2026-08-30T00:00:00.000Z',
        },
        contextBoundary: boundary('a2'),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
        phase: 'idle',
      }),
    });
    expect(inserted.ok).toBe(true);

    for (const [id, role, text] of [
      ['u1', 'user', 'first question'],
      ['a1', 'assistant', 'first answer'],
      ['u2', 'user', 'second question'],
      ['a2', 'assistant', 'second answer'],
    ] as const) {
      const appended = await target.store.appendMessage({
        id,
        runtimeGenerationId: 'gen-trunc',
        backendMessageId: `b-${id}`,
        role,
        text,
        status: 'done',
        createdAt: '2026-08-30T00:00:00.000Z',
      });
      expect(appended.ok).toBe(true);
    }
    await target.store.rebaseActiveLeaf('a1');
    expect(await target.store.getActiveLeaf()).toBe('a1');

    await seedDerivedSessionContextState({
      source: source.store,
      target: target.store,
      targetSessionId: target.sessionId,
      updatedAt: '2026-08-30T00:01:00.000Z',
    });
    const derived = await target.store.readContextState();
    expect(derived?.occupancy).toEqual({ kind: 'unknown', reason: 'derived-session' });
    expect(derived?.lastConfirmed).toBeUndefined();
    expect(derived?.contextBoundary.activeLeafMessageId).toBe('a1');
    expect(derived?.runId).toBeUndefined();
    expect(derived?.runtimeGenerationId).toBeUndefined();
    source.store.close();
    target.store.close();
  });

  it('invalidates a copied snapshot whose sessionId or schema version does not match the store', async () => {
    const { store, dbPath, sessionId } = await openStore('pack-mismatch');
    store.close();
    const db = new DatabaseSync(dbPath);
    db.prepare(
      `INSERT OR REPLACE INTO session_context_state(
        session_id, schema_version, revision, context_version, context_boundary_json, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      99,
      8,
      4,
      JSON.stringify(boundary('old-leaf')),
      JSON.stringify(
        unknownSnapshot('other-session', { revision: 8, contextVersion: 4, runId: 'copied-run' }),
      ),
    );
    db.close();
    const reopened = await openSessionTranscriptStore({
      dbPath,
      sessionId,
      projectPath: '/tmp/project',
    });
    const snapshot = await reopened.readContextState();
    expect(snapshot?.sessionId).toBe(sessionId);
    expect(snapshot?.occupancy.kind).toBe('unknown');
    expect(snapshot?.runId).toBeUndefined();
    expect(snapshot?.revision).toBe(1);
    reopened.close();
  });
});
