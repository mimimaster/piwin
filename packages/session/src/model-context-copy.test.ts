import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyModelContextLedger, copyModelContextStore } from './model-context-copy.js';
import { openModelContextStore } from './model-context-store.js';
import type { ContextSummaryPush } from '@piwin/contracts';

describe('copyModelContextLedger', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function openPair() {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-mvl-copy-'));
    dirs.push(dir);
    const source = await openModelContextStore({
      dbPath: join(dir, 'source.sqlite3'),
      sessionId: 'session-source',
    });
    return {
      dir,
      source,
      sourcePath: join(dir, 'source.sqlite3'),
      targetPath: join(dir, 'target.sqlite3'),
    };
  }

  function summary(
    sessionId: string,
    runId: string,
    userMessageId: string,
    requestOrdinal: number,
  ): ContextSummaryPush {
    return {
      type: 'agent/context-summary',
      sessionId,
      runId,
      requestClass: 'prompt',
      requestOrdinal,
      coverage: 'assembly-only',
      estimateSource: 'host-estimate',
      userMessageId,
      contributions: [],
    };
  }

  it('is a no-op when the source ledger file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-mvl-missing-'));
    dirs.push(dir);
    const copied = await copyModelContextLedger({
      sourceDbPath: join(dir, 'missing.sqlite3'),
      sourceSessionId: 'session-source',
      targetDbPath: join(dir, 'target.sqlite3'),
      targetSessionId: 'session-target',
      messageIdMap: new Map(),
    });
    expect(copied).toEqual({ copiedEvents: 0, copiedBlobs: 0 });
  });

  it('rewrites sessionId and userMessageId on a full duplicate', async () => {
    const { source, sourcePath, targetPath } = await openPair();
    await source.recordAssembly(summary('session-source', 'run-1', 'user-src', 1));
    await source.putBlob({ mediaType: 'text/plain', body: 'shared' });
    source.close();

    const copied = await copyModelContextLedger({
      sourceDbPath: sourcePath,
      sourceSessionId: 'session-source',
      targetDbPath: targetPath,
      targetSessionId: 'session-target',
      messageIdMap: new Map([['user-src', 'user-dst']]),
    });
    expect(copied.copiedEvents).toBeGreaterThan(0);

    const target = await openModelContextStore({
      dbPath: targetPath,
      sessionId: 'session-target',
    });
    const summaries = await target.listSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.sessionId).toBe('session-target');
    expect(summaries[0]?.userMessageId).toBe('user-dst');
    expect(summaries[0]?.runId).toBe('run-1');
    target.close();
  });

  it('fork retain drops later turns from the same run after the ledger boundary', async () => {
    const { source, sourcePath, targetPath } = await openPair();
    await source.recordAssembly(summary('session-source', 'run-1', 'user-keep', 1));
    await source.recordAssembly(summary('session-source', 'run-1', 'user-drop', 2));
    source.close();

    await copyModelContextLedger({
      sourceDbPath: sourcePath,
      sourceSessionId: 'session-source',
      targetDbPath: targetPath,
      targetSessionId: 'session-target',
      messageIdMap: new Map([['user-keep', 'user-keep-new']]),
      retain: {
        sourceMessageIds: new Set(['user-keep']),
        runIds: new Set(['run-1']),
      },
      boundarySourceMessageId: 'user-keep',
    });

    const target = await openModelContextStore({
      dbPath: targetPath,
      sessionId: 'session-target',
    });
    const summaries = await target.listSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.userMessageId).toBe('user-keep-new');
    expect(summaries[0]?.runId).toBe('run-1');
    target.close();
  });

  it('copies explicit blob refs needed by a retained fork event', async () => {
    const { source, sourcePath, targetPath } = await openPair();
    const blob = await source.putBlob({ mediaType: 'text/plain', body: 'fork blob' });
    await source.appendEvent({
      eventId: 'event-keep',
      type: 'turn/input',
      payload: { userMessageId: 'user-keep' },
      runId: 'run-1',
      idempotencyKey: 'idempotency-keep',
      createdAt: '2026-08-14T00:00:00.000Z',
      blobDigests: [blob.digest],
    });
    source.close();

    await copyModelContextLedger({
      sourceDbPath: sourcePath,
      sourceSessionId: 'session-source',
      targetDbPath: targetPath,
      targetSessionId: 'session-target',
      messageIdMap: new Map([['user-keep', 'user-keep-new']]),
      retain: {
        sourceMessageIds: new Set(['user-keep']),
        runIds: new Set(),
      },
      boundarySourceMessageId: 'user-keep',
    });

    const target = await openModelContextStore({
      dbPath: targetPath,
      sessionId: 'session-target',
    });
    const events = await target.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventId).toBe('event-keep');
    expect(events[0]?.idempotencyKey).toBe('idempotency-keep');
    expect(events[0]?.blobDigests).toEqual([blob.digest]);
    expect(await target.listBlobs()).toHaveLength(1);
    target.close();
  });

  it('copies a bounded open ledger with complete event metadata', async () => {
    const { source, targetPath } = await openPair();
    const first = await source.appendEvent({
      eventId: 'event-1',
      type: 'request/header',
      payload: { value: 1 },
      requestOrdinal: 4,
      idempotencyKey: 'idempotency-1',
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    await source.appendEvent({
      eventId: 'event-2',
      type: 'request/dispatch',
      payload: { value: 2 },
      requestOrdinal: 5,
      createdAt: '2026-08-14T00:00:01.000Z',
    });
    const target = await openModelContextStore({
      dbPath: targetPath,
      sessionId: 'session-target',
    });
    await copyModelContextStore(source, target, { maxSeq: first.seq });
    const events = await target.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      seq: 1,
      eventId: 'event-1',
      requestOrdinal: 4,
      idempotencyKey: 'idempotency-1',
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    target.close();
    source.close();
  });
});
