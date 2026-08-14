import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { digestContent, openModelContextStore } from './model-context-store.js';

describe('model-context store', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function openStore() {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-mvl-'));
    dirs.push(dir);
    return openModelContextStore({
      dbPath: join(dir, 'model-context.sqlite3'),
      sessionId: 'session-1',
    });
  }

  it('defaults coverage to assembly-only', async () => {
    const store = await openStore();
    expect(await store.getCoverage()).toBe('assembly-only');
    store.close();
  });

  it('deduplicates blobs by digest', async () => {
    const store = await openStore();
    const first = await store.putBlob({ mediaType: 'text/plain', body: 'hello' });
    const second = await store.putBlob({ mediaType: 'text/plain', body: 'hello' });
    expect(first.digest).toBe(digestContent(Buffer.from('hello')));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.digest).toBe(first.digest);
    store.close();
  });

  it('rolls back a failed append without leaving an event', async () => {
    const store = await openStore();
    await expect(
      store.appendEvent({
        type: 'turn/input',
        payload: BigInt(1),
      }),
    ).rejects.toThrow();
    expect(await store.listEvents()).toHaveLength(0);
    await expect(
      store.appendEvent({
        type: 'turn/input',
        payload: { ok: true },
      }),
    ).resolves.toMatchObject({ seq: 1 });
    store.close();
  });

  it('records assembly summaries without host paths', async () => {
    const store = await openStore();
    await store.recordAssembly({
      type: 'agent/context-summary',
      sessionId: 'session-1',
      runId: 'run-1',
      requestClass: 'prompt',
      requestOrdinal: 1,
      coverage: 'assembly-only',
      estimateSource: 'host-estimate',
      totalEstimatedTokens: 3,
      contributions: [
        {
          id: 'c1',
          kind: 'user',
          label: 'User',
          trustOrigin: 'user',
          canOpenOnClient: false,
          redactionState: 'none',
          estimatedTokens: 3,
        },
      ],
    });
    const summaries = await store.listSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.coverage).toBe('assembly-only');
    expect(summaries[0]?.type).toBe('agent/context-summary');
    expect(JSON.stringify(summaries)).not.toContain('/Users/');
    expect(await store.getCoverage()).toBe('assembly-only');
    store.close();
  });

  it('links only explicit assembly content refs', async () => {
    const store = await openStore();
    const blob = await store.putBlob({ mediaType: 'text/plain', body: 'assembly-content' });
    await store.recordAssembly({
      type: 'agent/context-summary',
      sessionId: 'session-1',
      runId: 'run-1',
      requestClass: 'prompt',
      requestOrdinal: 1,
      coverage: 'assembly-only',
      estimateSource: 'host-estimate',
      contributions: [
        {
          id: 'c1',
          kind: 'context-ref',
          label: 'Context',
          trustOrigin: 'local-file',
          contentRef: {
            digest: blob.digest,
            mediaType: 'text/plain',
            encoding: 'identity',
            byteLength: blob.byteLength,
          },
          canOpenOnClient: false,
          redactionState: 'none',
        },
      ],
    });
    const turnInput = (await store.listEvents()).find((event) => event.type === 'turn/input');
    expect(turnInput?.blobDigests).toEqual([blob.digest]);
    store.close();
  });

  it('tracks event blob references and prunes unreferenced blobs', async () => {
    const store = await openStore();
    const blob1 = await store.putBlob({ mediaType: 'text/plain', body: 'content-1' });
    const blob2 = await store.putBlob({ mediaType: 'text/plain', body: 'content-2' });
    const unreferencedBlob = await store.putBlob({ mediaType: 'text/plain', body: 'orphan-content' });

    await store.appendEvent({
      type: 'turn/input',
      payload: { note: 'referenced', ref: blob1.digest },
      blobDigests: [blob1.digest],
    });

    await store.appendEvent({
      type: 'turn/input',
      payload: { note: 'referenced 2', ref: blob2.digest },
      blobDigests: [blob2.digest],
    });

    const blobsBefore = await store.listBlobs();
    expect(blobsBefore).toHaveLength(3);

    const prunedCount = await store.pruneUnreferencedBlobs();
    expect(prunedCount).toBe(1);

    const blobsAfter = await store.listBlobs();
    expect(blobsAfter).toHaveLength(2);
    expect(blobsAfter.map((b) => b.digest)).not.toContain(unreferencedBlob.digest);

    store.close();
  });

  it('truncates events and cascades to orphan blobs', async () => {
    const store = await openStore();
    const blob1 = await store.putBlob({ mediaType: 'text/plain', body: 'turn-1-data' });
    const blob2 = await store.putBlob({ mediaType: 'text/plain', body: 'turn-2-data' });

    const event1 = await store.appendEvent({
      type: 'turn/input',
      payload: { turn: 1, digest: blob1.digest },
      blobDigests: [blob1.digest],
    });

    const event2 = await store.appendEvent({
      type: 'turn/input',
      payload: { turn: 2, digest: blob2.digest },
      blobDigests: [blob2.digest],
    });

    expect(event1.seq).toBe(1);
    expect(event2.seq).toBe(2);

    const result = await store.truncateEventsFrom(2);
    expect(result.removedEvents).toBe(1);
    expect(result.removedBlobs).toBe(1);

    const eventsRemaining = await store.listEvents();
    expect(eventsRemaining).toHaveLength(1);

    const blobsRemaining = await store.listBlobs();
    expect(blobsRemaining).toHaveLength(1);
    expect(blobsRemaining[0]?.digest).toBe(blob1.digest);

    store.close();
  });

  it('migrates an existing database to incremental auto-vacuum', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-mvl-migration-'));
    dirs.push(dir);
    const dbPath = join(dir, 'model-context.sqlite3');
    const legacy = new DatabaseSync(dbPath);
    legacy.exec('CREATE TABLE legacy_marker(value TEXT);');
    const before = legacy.prepare('PRAGMA auto_vacuum').get() as { auto_vacuum?: number };
    expect(before.auto_vacuum).toBe(0);
    legacy.close();

    const store = await openModelContextStore({ dbPath, sessionId: 'session-1' });
    store.close();

    const migrated = new DatabaseSync(dbPath);
    const after = migrated.prepare('PRAGMA auto_vacuum').get() as { auto_vacuum?: number };
    expect(after.auto_vacuum).toBe(2);
    migrated.close();
  });

  it('backfills legacy payload blob refs before GC', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-mvl-ref-migration-'));
    dirs.push(dir);
    const dbPath = join(dir, 'model-context.sqlite3');
    const initial = await openModelContextStore({ dbPath, sessionId: 'session-1' });
    const blob = await initial.putBlob({ mediaType: 'text/plain', body: 'legacy-content' });
    await initial.appendEvent({
      type: 'turn/input',
      payload: { legacyRef: blob.digest },
    });
    initial.close();

    const legacy = new DatabaseSync(dbPath);
    legacy.exec(
      `DELETE FROM model_context_event_blob;
       UPDATE model_context_meta SET format_version = 1;`,
    );
    legacy.close();

    const migrated = await openModelContextStore({ dbPath, sessionId: 'session-1' });
    expect((await migrated.listEvents())[0]?.blobDigests).toEqual([blob.digest]);
    expect(await migrated.pruneUnreferencedBlobs()).toBe(0);
    expect(await migrated.listBlobs()).toHaveLength(1);
    migrated.close();
  });
});
