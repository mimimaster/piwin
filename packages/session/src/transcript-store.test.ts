import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionTranscriptDocument, SessionTranscriptMessage } from '@piwin/contracts';
import {
  LEGACY_IMPORT_GENERATION,
  TranscriptIterationStaleError,
  USER_AUTHORED_GENERATION,
  openSessionTranscriptStore,
} from './transcript-store.js';

async function openStore(label: string): Promise<{
  store: import('./transcript-store.js').SessionTranscriptStore;
  dbPath: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), `piwin-store-${label}-`));
  const dbPath = join(rootDir, 'transcript.sqlite3');
  const store = await openSessionTranscriptStore({
    dbPath,
    sessionId: `session-${label}`,
    projectPath: '/tmp/project',
  });
  return { store, dbPath };
}

function makeLegacyDocument(
  count: number,
  sessionId = 'session-legacy',
): SessionTranscriptDocument {
  return {
    version: 1,
    sessionId,
    projectPath: '/tmp/project',
    messages: Array.from({ length: count }, (_, index) => ({
      id: `pi-message-${index}`,
      role: (index % 2 === 0 ? 'user' : 'assistant') as SessionTranscriptMessage['role'],
      text: `legacy turn ${index}`,
      createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      status: 'done' as const,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function messageInput(overrides: {
  id: string;
  runtimeGenerationId: string;
  backendMessageId: string;
  role?: SessionTranscriptMessage['role'];
  text?: string;
}) {
  return {
    id: overrides.id,
    runtimeGenerationId: overrides.runtimeGenerationId,
    backendMessageId: overrides.backendMessageId,
    role: overrides.role ?? ('assistant' as const),
    text: overrides.text ?? 'hello',
    status: 'done' as const,
    createdAt: new Date().toISOString(),
  };
}

function nativeEntryOf(payload: string) {
  return { format: 'pi-message-v1' as const, payload, byteLength: payload.length };
}

describe('SessionTranscriptStore native entries', () => {
  it('persists, reads, and cascades native entries on deleteMessage', async () => {
    const { store } = await openStore('native');
    await store.appendMessage(
      messageInput({ id: 'a1', runtimeGenerationId: 'gen-a', backendMessageId: 'b-a1' }),
    );
    await store.appendNativeEntries('a1', [
      { ordinal: 0, entry: nativeEntryOf('{"role":"assistant"}') },
      {
        ordinal: 1,
        entry: { format: 'pi-message-v1', payload: '', byteLength: 400_000, truncated: true },
      },
    ]);
    // Same ordinal replay is idempotent and never overwrites the stored payload.
    await store.appendNativeEntries('a1', [{ ordinal: 0, entry: nativeEntryOf('REPLAYED') }]);
    const entries = await store.readNativeEntries('a1');
    expect(entries).toHaveLength(2);
    expect(entries[0]?.payload).toBe('{"role":"assistant"}');
    expect(entries[0]?.truncated).toBeUndefined();
    expect(entries[1]?.truncated).toBe(true);
    expect(entries[1]?.byteLength).toBe(400_000);
    await store.deleteMessage('a1');
    expect(await store.readNativeEntries('a1')).toHaveLength(0);
  });

  it('truncateFrom removes native entries of removed rows only', async () => {
    const { store } = await openStore('native-truncate');
    await store.appendMessage(
      messageInput({ id: 'u1', runtimeGenerationId: 'gen-a', backendMessageId: 'b-u1', role: 'user' }),
    );
    await store.appendMessage(
      messageInput({ id: 'a1', runtimeGenerationId: 'gen-a', backendMessageId: 'b-a1' }),
    );
    await store.appendNativeEntries('u1', [{ ordinal: 0, entry: nativeEntryOf('keep') }]);
    await store.appendNativeEntries('a1', [{ ordinal: 0, entry: nativeEntryOf('drop') }]);
    const result = await store.truncateFrom('a1');
    expect(result.found).toBe(true);
    expect(await store.readNativeEntries('u1')).toHaveLength(1);
    expect(await store.readNativeEntries('a1')).toHaveLength(0);
  });
});

describe('SessionTranscriptStore run interventions', () => {
  it('commits the pending record and user row together and excludes it from model history', async () => {
    const { store } = await openStore('intervention-create');
    const created = await store.createRunIntervention({
      interventionId: 'intervention-1',
      sessionId: 'session-intervention-create',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      userMessageId: 'user-intervention-1',
      input: { text: 'change direction' },
      preparedText: 'change direction',
      fingerprint: 'fingerprint-1',
      submittedAt: '2026-08-15T10:00:00.000Z',
    });

    expect(created).toMatchObject({
      outcome: 'created',
      intervention: { status: 'pending', revision: 1, sequence: 1 },
    });
    expect(await store.getMessage('user-intervention-1')).toMatchObject({
      text: 'change direction',
      instructionDelivery: {
        kind: 'run-intervention',
        status: 'pending',
        revision: 1,
      },
    });
    expect(await store.buildHistoryWindow()).toEqual([]);

    const applying = await store.transitionRunIntervention({
      interventionId: 'intervention-1',
      expectedRevision: 1,
      from: ['pending'],
      to: 'applying',
      updatedAt: '2026-08-15T10:00:01.000Z',
    });
    const applied = await store.transitionRunIntervention({
      interventionId: 'intervention-1',
      expectedRevision: applying?.revision ?? 0,
      from: ['applying'],
      to: 'applied',
      updatedAt: '2026-08-15T10:00:02.000Z',
      appliedAt: '2026-08-15T10:00:02.000Z',
      appliedRequestOrdinal: 2,
    });
    expect(applied).toMatchObject({ status: 'applied', revision: 3, appliedRequestOrdinal: 2 });
    expect(await store.buildHistoryWindow()).toEqual([
      { role: 'user', text: 'change direction' },
    ]);
    store.close();
  });

  it('is idempotent by intervention id and rejects a different fingerprint', async () => {
    const { store } = await openStore('intervention-idempotency');
    const input = {
      interventionId: 'intervention-1',
      sessionId: 'session-intervention-idempotency',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      userMessageId: 'user-intervention-1',
      input: { text: 'change direction' },
      preparedText: 'change direction',
      fingerprint: 'fingerprint-1',
      submittedAt: '2026-08-15T10:00:00.000Z',
    } as const;
    expect((await store.createRunIntervention(input)).outcome).toBe('created');
    expect((await store.createRunIntervention(input)).outcome).toBe('replayed');
    expect(
      (
        await store.createRunIntervention({
          ...input,
          input: { text: 'different' },
          preparedText: 'different',
          fingerprint: 'fingerprint-2',
        })
      ).outcome,
    ).toBe('idempotency-conflict');
    expect(await store.count()).toBe(1);
    store.close();
  });
});

describe('SessionTranscriptStore queued turns', () => {
  it('stores a queued user row, filters pending history, and includes started history', async () => {
    const { store } = await openStore('queued-create');
    const created = await store.createQueuedTurn({
      queuedTurnId: 'queued-1',
      sessionId: 'session-queued-create',
      userMessageId: 'user-queued-1',
      mode: 'next',
      input: { text: 'do this next' },
      fingerprint: 'queue-fingerprint-1',
      submittedAt: '2026-08-15T10:00:00.000Z',
    });
    expect(created).toMatchObject({
      outcome: 'created',
      queuedTurn: { status: 'pending', sequence: 1, revision: 1 },
    });
    expect(await store.buildHistoryWindow()).toEqual([]);
    const started = await store.transitionQueuedTurn({
      queuedTurnId: 'queued-1',
      expectedRevision: 1,
      from: ['pending'],
      to: 'started',
      startedRunId: 'run-2',
      updatedAt: '2026-08-15T10:00:01.000Z',
    });
    expect(started).toMatchObject({ status: 'started', revision: 2, startedRunId: 'run-2' });
    expect(await store.getMessage('user-queued-1')).toMatchObject({
      runId: 'run-2',
      instructionDelivery: {
        kind: 'queued-turn',
        status: 'started',
        targetRunId: 'run-2',
      },
    });
    expect(await store.buildHistoryWindow()).toEqual([{ role: 'user', text: 'do this next' }]);
    store.close();
  });

  it('converts a pending queued turn into an intervention atomically', async () => {
    const { store } = await openStore('queued-conversion');
    await store.createQueuedTurn({
      queuedTurnId: 'queued-1',
      sessionId: 'session-queued-conversion',
      userMessageId: 'user-queued-1',
      mode: 'next',
      input: { text: 'steer instead' },
      fingerprint: 'queue-fingerprint-1',
      submittedAt: '2026-08-15T10:00:00.000Z',
    });
    const conversion = {
      queuedTurnId: 'queued-1',
      expectedRevision: 1,
      interventionId: 'intervention-1',
      runId: 'run-9',
      runtimeGenerationId: 'generation-1',
      userMessageId: 'user-queued-1',
      input: { text: 'steer instead' },
      preparedText: 'steer instead',
      fingerprint: 'intervention-fingerprint-1',
      updatedAt: '2026-08-15T10:00:05.000Z',
    } as const;
    const converted = await store.convertQueuedTurnToIntervention(conversion);
    expect(converted).toMatchObject({
      outcome: 'converted',
      queuedTurn: {
        status: 'cancelled',
        terminalReason: 'converted-to-intervention',
        revision: 2,
      },
      intervention: { interventionId: 'intervention-1', status: 'pending', runId: 'run-9' },
    });
    // The queued turn's user row is re-bound in place, never duplicated.
    expect(await store.count()).toBe(1);
    expect(await store.getMessage('user-queued-1')).toMatchObject({
      runId: 'run-9',
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: 'intervention-1',
        status: 'pending',
      },
    });
    expect(await store.getQueuedTurn('queued-1')).toMatchObject({ status: 'cancelled' });
    expect((await store.listQueuedTurns()).queuedTurns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ queuedTurnId: 'queued-1', status: 'cancelled' }),
      ]),
    );

    // An ACK-timeout retry replays the durable outcome without new writes.
    expect((await store.convertQueuedTurnToIntervention(conversion)).outcome).toBe('replayed');
    expect(await store.count()).toBe(1);

    // A stale revision or a drain-raced turn fails closed.
    await store.createQueuedTurn({
      queuedTurnId: 'queued-2',
      sessionId: 'session-queued-conversion',
      userMessageId: 'user-queued-2',
      mode: 'next',
      input: { text: 'second turn' },
      fingerprint: 'queue-fingerprint-2',
      submittedAt: '2026-08-15T10:00:08.000Z',
    });
    expect(
      (
        await store.convertQueuedTurnToIntervention({
          ...conversion,
          queuedTurnId: 'queued-2',
          userMessageId: 'user-queued-2',
          interventionId: 'intervention-2',
          expectedRevision: 7,
          fingerprint: 'intervention-fingerprint-2',
        })
      ).outcome,
    ).toBe('queued-turn-revision-conflict');
    await store.transitionQueuedTurn({
      queuedTurnId: 'queued-2',
      expectedRevision: 1,
      from: ['pending'],
      to: 'starting',
      updatedAt: '2026-08-15T10:00:09.000Z',
    });
    expect(
      (
        await store.convertQueuedTurnToIntervention({
          ...conversion,
          queuedTurnId: 'queued-2',
          userMessageId: 'user-queued-2',
          interventionId: 'intervention-2',
          expectedRevision: 2,
          fingerprint: 'intervention-fingerprint-2',
        })
      ).outcome,
    ).toBe('queued-turn-not-pending');
    store.close();
  });

  it('replays the same queued identity even when PromptInput object keys arrive in another order', async () => {
    const { store } = await openStore('queued-idempotency');
    const first = await store.createQueuedTurn({
      queuedTurnId: 'queued-idempotent',
      sessionId: 'session-queued-idempotency',
      userMessageId: 'user-idempotent',
      mode: 'next',
      input: {
        text: 'same turn',
        clientMessageId: 'user-idempotent',
        agentMode: 'plan',
      },
      fingerprint: 'same-fingerprint',
      submittedAt: '2026-08-15T10:00:00.000Z',
    });
    expect(first.outcome).toBe('created');
    const replay = await store.createQueuedTurn({
      queuedTurnId: 'queued-idempotent',
      sessionId: 'session-queued-idempotency',
      userMessageId: 'user-idempotent',
      mode: 'next',
      input: {
        agentMode: 'plan',
        clientMessageId: 'user-idempotent',
        text: 'same turn',
      },
      fingerprint: 'same-fingerprint',
      submittedAt: '2026-08-15T10:00:02.000Z',
    });
    expect(replay).toMatchObject({ outcome: 'replayed', queuedTurn: { revision: 1 } });
    store.close();
  });

  it('enforces revision CAS and deterministic reorder order', async () => {
    const { store } = await openStore('queued-reorder');
    for (const [index, id] of ['one', 'two', 'three'].entries()) {
      await store.createQueuedTurn({
        queuedTurnId: `queued-${id}`,
        sessionId: 'session-queued-reorder',
        userMessageId: `user-${id}`,
        mode: 'next',
        input: { text: id },
        fingerprint: `fingerprint-${id}`,
        submittedAt: `2026-08-15T10:00:0${index}.000Z`,
      });
    }
    const before = await store.listQueuedTurns();
    const reordered = await store.reorderQueuedTurns({
      expectedQueueRevision: before.queueRevision,
      orderedQueuedTurnIds: ['queued-three', 'queued-one', 'queued-two'],
    });
    expect(reordered?.queuedTurns.map((item) => item.queuedTurnId)).toEqual([
      'queued-three',
      'queued-one',
      'queued-two',
    ]);
    expect(
      await store.reorderQueuedTurns({
        expectedQueueRevision: before.queueRevision,
        orderedQueuedTurnIds: ['queued-one', 'queued-two', 'queued-three'],
      }),
    ).toBeUndefined();
    expect(
      await store.updatePendingQueuedTurn({
        queuedTurnId: 'queued-one',
        expectedRevision: 1,
        input: { text: 'stale edit' },
        fingerprint: 'stale',
        updatedAt: '2026-08-15T10:01:00.000Z',
      }),
    ).toBeUndefined();
    store.close();
  });

  it('reorders pending turns without colliding with terminal queue rows', async () => {
    const { store } = await openStore('queued-reorder-terminal-row');
    const first = await store.createQueuedTurn({
      queuedTurnId: 'queued-started',
      sessionId: 'session-queued-reorder-terminal-row',
      userMessageId: 'user-started',
      mode: 'next',
      input: { text: 'already started' },
      fingerprint: 'fingerprint-started',
      submittedAt: '2026-08-15T10:00:00.000Z',
    });
    expect(first.outcome).toBe('created');
    await store.transitionQueuedTurn({
      queuedTurnId: 'queued-started',
      expectedRevision: 1,
      from: ['pending'],
      to: 'started',
      startedRunId: 'run-started',
      updatedAt: '2026-08-15T10:00:01.000Z',
    });
    for (const id of ['one', 'two']) {
      await store.createQueuedTurn({
        queuedTurnId: `queued-${id}`,
        sessionId: 'session-queued-reorder-terminal-row',
        userMessageId: `user-${id}`,
        mode: 'next',
        input: { text: id },
        fingerprint: `fingerprint-${id}`,
        submittedAt: '2026-08-15T10:00:02.000Z',
      });
    }
    const before = await store.listQueuedTurns();
    const reordered = await store.reorderQueuedTurns({
      expectedQueueRevision: before.queueRevision,
      orderedQueuedTurnIds: ['queued-two', 'queued-one'],
    });
    expect(reordered?.queuedTurns.map((item) => item.queuedTurnId)).toEqual([
      'queued-started',
      'queued-two',
      'queued-one',
    ]);
    expect(reordered?.queuedTurns.slice(1).map((item) => item.status)).toEqual([
      'pending',
      'pending',
    ]);
    store.close();
  });

  it('keeps aggregate queue bounds when a pending turn is edited', async () => {
    const { store } = await openStore('queued-edit-bounds');
    for (let index = 0; index < 7; index += 1) {
      const created = await store.createQueuedTurn({
        queuedTurnId: `queued-large-${index}`,
        sessionId: 'session-queued-edit-bounds',
        userMessageId: `user-large-${index}`,
        mode: 'next',
        input: { text: 'a'.repeat(64 * 1024) },
        fingerprint: `fingerprint-large-${index}`,
        submittedAt: '2026-08-15T10:00:00.000Z',
      });
      expect(created.outcome).toBe('created');
    }
    const smallInputs = ['b'.repeat(60 * 1024), 'small'];
    for (let index = 0; index < smallInputs.length; index += 1) {
      const text = smallInputs[index];
      if (text === undefined) continue;
      const created = await store.createQueuedTurn({
        queuedTurnId: `queued-${index}`,
        sessionId: 'session-queued-edit-bounds',
        userMessageId: `user-${index}`,
        mode: 'next',
        input: { text },
        fingerprint: `fingerprint-${index}`,
        submittedAt: '2026-08-15T10:00:01.000Z',
      });
      expect(created.outcome).toBe('created');
    }
    const updated = await store.updatePendingQueuedTurn({
      queuedTurnId: 'queued-1',
      expectedRevision: 1,
      input: { text: 'b'.repeat(64 * 1024) },
      fingerprint: 'fingerprint-too-large',
      updatedAt: '2026-08-15T10:00:02.000Z',
    });
    expect(updated).toEqual({ outcome: 'queue-full' });
    expect((await store.getQueuedTurn('queued-1'))?.input.text).toBe('small');
    store.close();
  });

  it('reconciles ambiguous replace and starting records after restart', async () => {
    const { store } = await openStore('queued-reconcile');
    await store.createQueuedTurn({
      queuedTurnId: 'queued-replace',
      sessionId: 'session-queued-reconcile',
      userMessageId: 'user-replace',
      mode: 'replace',
      replaceRunId: 'run-old',
      input: { text: 'replace it' },
      fingerprint: 'replace-fingerprint',
      submittedAt: '2026-08-15T10:00:00.000Z',
    });
    const reconciled = await store.reconcileQueuedTurns('2026-08-15T10:00:01.000Z');
    expect(reconciled).toMatchObject([
      { queuedTurnId: 'queued-replace', status: 'failed', terminalReason: 'host-restarted' },
    ]);
    store.close();
  });
});

describe('SessionTranscriptStore', () => {
  it('appends rows with provenance and treats same-generation replay as idempotent', async () => {
    const { store } = await openStore('replay');
    const first = await store.appendMessage(
      messageInput({
        id: 'piw-m-a1',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'pi-message-2',
      }),
    );
    expect(first).toEqual({ ok: true });
    // Same generation + same backend id: idempotent replay, one row.
    const replay = await store.appendMessage(
      messageInput({
        id: 'piw-m-a1',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'pi-message-2',
      }),
    );
    expect(replay).toEqual({ ok: true, replayed: true });
    expect(await store.count()).toBe(1);
    const tail = await store.listTail(10);
    expect(tail).toHaveLength(1);
    expect(tail[0]).toMatchObject({
      id: 'piw-m-a1',
      runtimeGenerationId: 'gen-a',
      text: 'hello',
    });
    store.close();
  });

  it('persists two rows when different generations reuse the same backend id', async () => {
    const { store } = await openStore('twogens');
    await store.appendMessage(
      messageInput({
        id: 'piw-m-a1',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'pi-message-2',
        text: 'gen-a answer',
      }),
    );
    await store.appendMessage(
      messageInput({
        id: 'piw-m-b1',
        runtimeGenerationId: 'gen-b',
        backendMessageId: 'pi-message-2',
        text: 'gen-b answer',
      }),
    );
    expect(await store.count()).toBe(2);
    const tail = await store.listTail(10);
    expect(tail.map((message) => message.text)).toEqual(['gen-a answer', 'gen-b answer']);
    store.close();
  });

  it('rejects a normalized id collision with different provenance', async () => {
    const { store } = await openStore('collision');
    await store.appendMessage(
      messageInput({
        id: 'piw-m-x',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'backend-1',
      }),
    );
    const collision = await store.appendMessage(
      messageInput({
        id: 'piw-m-x',
        runtimeGenerationId: 'gen-b',
        backendMessageId: 'backend-2',
      }),
    );
    expect(collision).toEqual({ ok: false, reason: 'provenance-collision' });
    expect(await store.count()).toBe(1);
    store.close();
  });

  it('rejects a provenance replay carrying a different normalized id', async () => {
    const { store } = await openStore('replay-id-mismatch');
    await store.appendMessage(
      messageInput({
        id: 'piw-m-original',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'backend-1',
      }),
    );
    await expect(
      store.appendMessage(
        messageInput({
          id: 'piw-m-different',
          runtimeGenerationId: 'gen-a',
          backendMessageId: 'backend-1',
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'provenance-collision' });
    expect(await store.count()).toBe(1);
    store.close();
  });

  it('updates only the affected row and never unrelated rows', async () => {
    const { store } = await openStore('update');
    await store.appendMessage(
      messageInput({
        id: 'piw-m-a1',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'b1',
        text: 'before',
      }),
    );
    await store.appendMessage(
      messageInput({
        id: 'piw-m-b1',
        runtimeGenerationId: 'gen-b',
        backendMessageId: 'b2',
        text: 'untouched',
      }),
    );
    expect(await store.updateMessage('piw-m-a1', { text: 'after', status: 'done' })).toBe(true);
    expect(await store.updateMessage('piw-m-missing', { text: 'nope' })).toBe(false);

    const tail = await store.listTail(10);
    expect(tail.find((message) => message.id === 'piw-m-a1')?.text).toBe('after');
    expect(tail.find((message) => message.id === 'piw-m-b1')?.text).toBe('untouched');
    expect(await store.count()).toBe(2);
    store.close();
  });

  it('round-trips native search evidence through metadata_json', async () => {
    const { store } = await openStore('search-evidence');
    const searchEvidence = {
      query: 'piwin',
      provenance: 'native' as const,
      citations: [
        { title: 'Piwin', url: 'https://example.com/piwin', provenance: 'native' as const },
        { title: 'Piwin docs', url: 'https://example.com/docs', provenance: 'native' as const },
      ],
    };
    await store.appendMessage({
      ...messageInput({
        id: 'piw-m-search',
        runtimeGenerationId: 'gen-search',
        backendMessageId: 'backend-search',
      }),
      metadata: { searchEvidence },
    });

    await expect(store.getMessage('piw-m-search')).resolves.toMatchObject({
      id: 'piw-m-search',
      searchEvidence,
    });
    store.close();
  });

  it('round-trips reply writer attribution through metadata_json', async () => {
    const { store } = await openStore('reply-writer');
    const replyWriter = {
      language: 'zh-CN' as const,
      sourceText: '登录 路径 已改',
      model: {
        protocol: 'openai-compatible' as const,
        providerId: 'openai',
        modelId: 'gpt-4.1',
      },
    };
    await store.appendMessage({
      ...messageInput({
        id: 'piw-m-writer',
        runtimeGenerationId: 'gen-writer',
        backendMessageId: 'backend-writer',
        role: 'assistant',
        text: '登录路径已经改好了。',
      }),
      metadata: { replyWriter },
    });
    await expect(store.getMessage('piw-m-writer')).resolves.toMatchObject({
      text: '登录路径已经改好了。',
      replyWriter,
    });
    store.close();
  });

  it('round-trips assistant reasoning boundaries through metadata_json', async () => {
    const { store } = await openStore('thinking-boundaries');
    await store.appendMessage({
      ...messageInput({
        id: 'piw-m-thinking',
        runtimeGenerationId: 'gen-thinking',
        backendMessageId: 'backend-thinking',
      }),
      thinking: 'reasoning',
      metadata: {
        thinkingStartedAt: '2026-08-12T08:00:01.000Z',
        thinkingEndedAt: '2026-08-12T08:00:05.000Z',
      },
    });

    await expect(store.getMessage('piw-m-thinking')).resolves.toMatchObject({
      thinking: 'reasoning',
      thinkingStartedAt: '2026-08-12T08:00:01.000Z',
      thinkingEndedAt: '2026-08-12T08:00:05.000Z',
    });
    store.close();
  });

  it('keeps cross-generation tool-call cards attached to their own assistant rows', async () => {
    const { store } = await openStore('tools');
    await store.appendMessage(
      messageInput({
        id: 'piw-m-a1',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'pi-message-2',
        role: 'assistant',
        text: '',
      }),
    );
    await store.appendMessage(
      messageInput({
        id: 'piw-m-b1',
        runtimeGenerationId: 'gen-b',
        backendMessageId: 'pi-message-2',
        role: 'assistant',
        text: '',
      }),
    );
    await store.updateMessage('piw-m-a1', {
      tools: [{ toolCallId: 'piw-t-a1', toolName: 'bash', status: 'done', output: 'a' }],
    });
    await store.updateMessage('piw-m-b1', {
      tools: [{ toolCallId: 'piw-t-b1', toolName: 'read', status: 'done', output: 'b' }],
    });

    const tail = await store.listTail(10);
    const genA = tail.find((message) => message.id === 'piw-m-a1');
    const genB = tail.find((message) => message.id === 'piw-m-b1');
    expect(genA?.tools?.map((tool) => tool.toolCallId)).toEqual(['piw-t-a1']);
    expect(genB?.tools?.map((tool) => tool.toolCallId)).toEqual(['piw-t-b1']);
    store.close();
  });

  it('imports a legacy document transactionally, idempotently, and losslessly', async () => {
    const { store } = await openStore('legacy');
    const document = makeLegacyDocument(5);
    const first = await store.importLegacyDocument(document);
    expect(first.imported).toBe(5);
    expect(await store.isMigrated()).toBe(true);
    expect((await store.verifyLegacyDocument(document)).matches).toBe(true);

    // Idempotent second import.
    expect((await store.importLegacyDocument(document)).imported).toBe(0);
    expect(await store.count()).toBe(5);

    // Lossless: every legacy id is addressable under the reserved namespace.
    const tail = await store.listTail(10);
    expect(tail.map((message) => message.id)).toEqual([
      'pi-message-0',
      'pi-message-1',
      'pi-message-2',
      'pi-message-3',
      'pi-message-4',
    ]);
    expect(tail.every((message) => message.runtimeGenerationId === LEGACY_IMPORT_GENERATION)).toBe(
      true,
    );
    store.close();
  });

  it('does not mix a different legacy document after the first import', async () => {
    const { store } = await openStore('legacy-mismatch');
    const original = makeLegacyDocument(3, 'session-legacy-mismatch');
    await store.importLegacyDocument(original);
    const different = makeLegacyDocument(3, 'session-legacy-mismatch');
    different.messages[0]!.text = 'changed';
    expect((await store.importLegacyDocument(different)).imported).toBe(0);
    expect(await store.count()).toBe(3);
    expect((await store.verifyLegacyDocument(original)).matches).toBe(true);
    store.close();
  });

  it('detects persisted content corruption instead of trusting the import digest', async () => {
    const { store } = await openStore('legacy-corruption');
    const original = makeLegacyDocument(3, 'session-legacy-corruption');
    await store.importLegacyDocument(original);
    await store.updateMessage('pi-message-1', { text: 'corrupted after import' });
    expect((await store.verifyLegacyDocument(original)).matches).toBe(false);
    await expect(store.importLegacyDocument(original)).rejects.toThrow(/no longer matches/);
    store.close();
  });

  it('rolls back an interrupted import so the store stays empty', async () => {
    const { store } = await openStore('interrupted');
    // A malformed document (message missing text) fails mid-insert; the
    // transaction rolls back and no row survives.
    const broken = makeLegacyDocument(2, 'session-interrupted');
    (broken.messages[1] as { text?: string }).text = undefined as unknown as string;
    await expect(store.importLegacyDocument(broken)).rejects.toThrow();
    expect(await store.count()).toBe(0);
    expect(await store.isMigrated()).toBe(false);
    store.close();
  });

  it('keeps legacy ids and a post-migration generation distinct', async () => {
    const { store } = await openStore('legacy-live');
    const document = makeLegacyDocument(2, 'session-legacy-live');
    await store.importLegacyDocument(document);
    // A live generation normalizes its ids; legacy naked ids never collide.
    const live = await store.appendMessage(
      messageInput({
        id: 'piw-m-live-1',
        runtimeGenerationId: 'gen-live',
        backendMessageId: 'pi-message-0',
        text: 'live answer',
      }),
    );
    expect(live).toEqual({ ok: true });
    expect(await store.count()).toBe(3);
    const tail = await store.listTail(10);
    expect(tail.some((message) => message.id === 'piw-m-live-1')).toBe(true);
    expect(tail.some((message) => message.id === 'pi-message-0')).toBe(true);
    store.close();
  });

  it('publishes bounded tail windows with sequence cursors', async () => {
    const { store } = await openStore('tail');
    for (let index = 0; index < 30; index += 1) {
      await store.appendMessage(
        messageInput({
          id: `piw-m-${index}`,
          runtimeGenerationId: 'gen-a',
          backendMessageId: `b-${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: `turn ${index}`,
        }),
      );
    }
    const newest = await store.listTail(10);
    expect(newest).toHaveLength(10);
    expect(newest.at(-1)?.id).toBe('piw-m-29');
    // sequence 21 → rows 1..20 → newest 10 = sequence 11..20 = piw-m-10..19.
    const older = await store.listTail(10, 21);
    expect(older.map((message) => message.id)).toEqual([
      'piw-m-10',
      'piw-m-11',
      'piw-m-12',
      'piw-m-13',
      'piw-m-14',
      'piw-m-15',
      'piw-m-16',
      'piw-m-17',
      'piw-m-18',
      'piw-m-19',
    ]);
    store.close();
  });

  it('publishes revision-bound transcript pages with byte clipping', async () => {
    const { store } = await openStore('transcript-page');
    for (let index = 0; index < 30; index += 1) {
      await store.appendMessage(
        messageInput({
          id: `piw-m-${index}`,
          runtimeGenerationId: 'gen-a',
          backendMessageId: `b-${index}`,
          text: index === 29 ? 'x'.repeat(100_000) : `turn ${index}`,
        }),
      );
    }
    const newest = await store.transcriptPage({
      sessionId: 'session-transcript-page',
      limit: 10,
      maximumBytes: 16 * 1024,
    });
    expect(newest.status).toBe('page');
    if (newest.status !== 'page') throw new Error('expected page');
    expect(newest.page.totalCount).toBe(30);
    expect(newest.page.messageBytes).toBeLessThanOrEqual(16 * 1024);
    expect(newest.page.truncatedMessageIds).toEqual(['piw-m-29']);
    expect(newest.page.olderCursor).toBeDefined();

    const changedLimits = await store.transcriptPage({
      sessionId: 'session-transcript-page',
      limit: 8,
      maximumBytes: 16 * 1024,
      ...(newest.page.olderCursor !== undefined ? { beforeCursor: newest.page.olderCursor } : {}),
    });
    expect(changedLimits).toEqual({
      status: 'stale-cursor',
      currentRevision: newest.page.revision,
    });

    await store.appendMessage(
      messageInput({
        id: 'piw-m-new',
        runtimeGenerationId: 'gen-b',
        backendMessageId: 'b-new',
      }),
    );
    const stale = await store.transcriptPage({
      sessionId: 'session-transcript-page',
      limit: 10,
      maximumBytes: 16 * 1024,
      ...(newest.page.olderCursor !== undefined ? { beforeCursor: newest.page.olderCursor } : {}),
    });
    expect(stale.status).toBe('stale-cursor');
    store.close();
  });

  it('rejects limits that would disable bounded reads', async () => {
    const { store } = await openStore('invalid-bounds');
    await expect(store.listTail(-1)).rejects.toThrow(/between 1 and/);
    await expect(store.listTail(101)).rejects.toThrow(/between 1 and/);
    await expect(store.buildHistoryWindow({ maxMessages: -1 })).rejects.toThrow(/between 1 and/);
    const iterate = store.iterateAll(-1);
    await expect(iterate[Symbol.asyncIterator]().next()).rejects.toThrow(/between 1 and/);
    store.close();
  });

  it('marks a fresh v2 store authoritative without a legacy import', async () => {
    const { store } = await openStore('fresh-authority');
    expect(await store.isMigrated()).toBe(false);
    await store.markAuthoritative();
    expect(await store.isMigrated()).toBe(true);
    store.close();
  });

  it('returns bounded history windows and the newest model snapshot', async () => {
    const { store } = await openStore('history');
    for (let index = 0; index < 60; index += 1) {
      await store.appendMessage({
        ...messageInput({
          id: `piw-m-${index}`,
          runtimeGenerationId: 'gen-a',
          backendMessageId: `b-${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: `turn ${index} `.repeat(20),
        }),
        ...(index % 2 === 1
          ? {
              model: {
                protocol: 'openai-compatible' as const,
                providerId: 'p',
                modelId: `model-${index}`,
              },
            }
          : {}),
      });
    }
    const history = await store.buildHistoryWindow({ maxMessages: 10, maxChars: 2000 });
    expect(history.length).toBeLessThanOrEqual(10);
    expect(history.every((item) => item.text.length <= 2000)).toBe(true);
    expect(history.some((item) => item.role === 'assistant')).toBe(true);

    const model = await store.recentModel();
    expect(model?.modelId).toBe('model-59');
    store.close();
  });

  it('pages the outline without loading message bodies and rejects stale cursors', async () => {
    const { store } = await openStore('outline');
    for (let index = 0; index < 25; index += 1) {
      await store.appendMessage(
        messageInput({
          id: `piw-m-${index}`,
          runtimeGenerationId: 'gen-a',
          backendMessageId: `b-${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: `turn ${index}`,
        }),
      );
    }
    const newest = await store.outlinePage({ sessionId: 'session-outline', limit: 10 });
    expect(newest.recent).toBe(true);
    expect(newest.hasOlder).toBe(true);
    expect(newest.nodes.map((node) => node.id)).toEqual([
      'piw-m-15',
      'piw-m-16',
      'piw-m-17',
      'piw-m-18',
      'piw-m-19',
      'piw-m-20',
      'piw-m-21',
      'piw-m-22',
      'piw-m-23',
      'piw-m-24',
    ]);
    if (newest.olderCursor === undefined) throw new Error('expected older cursor');

    const older = await store.outlinePage({
      sessionId: 'session-outline',
      limit: 10,
      beforeCursor: newest.olderCursor,
    });
    expect(older.recent).toBe(false);
    expect(older.nodes.map((node) => node.id)).toEqual([
      'piw-m-5',
      'piw-m-6',
      'piw-m-7',
      'piw-m-8',
      'piw-m-9',
      'piw-m-10',
      'piw-m-11',
      'piw-m-12',
      'piw-m-13',
      'piw-m-14',
    ]);

    // Mutations invalidate the cursor: an appended row changes the revision.
    await store.appendMessage(
      messageInput({
        id: 'piw-m-new',
        runtimeGenerationId: 'gen-b',
        backendMessageId: 'b-new',
        text: 'newest turn',
      }),
    );
    const stale = await store.outlinePage({
      sessionId: 'session-outline',
      limit: 10,
      beforeCursor: newest.olderCursor,
    });
    expect(stale.nodes).toEqual([]);
    expect(stale.hasOlder).toBe(false);
    store.close();
  });

  it('truncates from a message id exactly', async () => {
    const { store } = await openStore('truncate');
    for (let index = 0; index < 8; index += 1) {
      await store.appendMessage(
        messageInput({
          id: `piw-m-${index}`,
          runtimeGenerationId: 'gen-a',
          backendMessageId: `b-${index}`,
          text: `turn ${index}`,
        }),
      );
    }
    const result = await store.truncateFrom('piw-m-3');
    expect(result).toEqual({ found: true, removedCount: 5, remainingCount: 3 });
    expect((await store.listTail(10)).map((message) => message.id)).toEqual([
      'piw-m-0',
      'piw-m-1',
      'piw-m-2',
    ]);
    expect((await store.truncateFrom('piw-m-missing')).found).toBe(false);
    store.close();
  });

  it('iterates the full transcript in bounded batches for export', async () => {
    const { store } = await openStore('iterate');
    for (let index = 0; index < 12; index += 1) {
      await store.appendMessage(
        messageInput({
          id: `piw-m-${index}`,
          runtimeGenerationId: 'gen-a',
          backendMessageId: `b-${index}`,
          text: `turn ${index}`,
        }),
      );
    }
    const collected: string[] = [];
    for await (const message of store.iterateAll(5)) {
      collected.push(message.id);
    }
    expect(collected).toHaveLength(12);
    expect(collected[0]).toBe('piw-m-0');
    expect(collected[11]).toBe('piw-m-11');
    store.close();
  });

  it('fails a streamed full iteration when the source revision changes', async () => {
    const { store } = await openStore('iterate-stale');
    for (let index = 0; index < 2; index += 1) {
      await store.appendMessage(
        messageInput({
          id: `piw-m-${index}`,
          runtimeGenerationId: 'gen-a',
          backendMessageId: `b-${index}`,
          text: `turn ${index}`,
        }),
      );
    }
    const iterator = store.iterateAll(1)[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.id).toBe('piw-m-0');
    await store.updateMessage('piw-m-0', { text: 'changed during copy' });
    await expect(iterator.next()).rejects.toBeInstanceOf(TranscriptIterationStaleError);
    store.close();
  });

  it('keeps tail/history/outline bounded with 10,000 rows', async () => {
    const { store } = await openStore('scale');
    for (let index = 0; index < 10_000; index += 1) {
      await store.appendMessage(
        messageInput({
          id: `piw-m-${index}`,
          runtimeGenerationId: 'gen-a',
          backendMessageId: `b-${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: `turn ${index}`,
        }),
      );
    }
    expect(await store.count()).toBe(10_000);
    expect(await store.listTail(50)).toHaveLength(50);
    expect((await store.buildHistoryWindow({ maxMessages: 40 })).length).toBeLessThanOrEqual(40);
    const outline = await store.outlinePage({ sessionId: 'session-scale', limit: 100 });
    expect(outline.nodes.length).toBeLessThanOrEqual(100);
    store.close();
  });

  it('builds a user-only navigation index with a stable independent revision', async () => {
    const { store } = await openStore('user-index');
    await store.appendMessage(
      messageInput({
        id: 'assistant-1',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'assistant-1',
        role: 'assistant',
        text: 'answer',
      }),
    );
    const empty = await store.userMessageIndex({
      sessionId: 'session-user-index',
      maximumTicks: 16,
    });
    expect(empty.totalUserMessages).toBe(0);
    const firstRevision = empty.revision;

    await store.appendMessage(
      messageInput({
        id: 'user-1',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'user-1',
        role: 'user',
        text: '  first   request  ',
      }),
    );
    await store.appendMessage(
      messageInput({
        id: 'assistant-2',
        runtimeGenerationId: 'gen-a',
        backendMessageId: 'assistant-2',
        role: 'assistant',
        text: 'second answer',
      }),
    );
    const indexed = await store.userMessageIndex({
      sessionId: 'session-user-index',
      maximumTicks: 16,
    });
    expect(indexed).toMatchObject({
      totalUserMessages: 1,
      mode: 'exact',
    });
    expect(indexed.anchors[0]).toMatchObject({
      messageId: 'user-1',
      ordinal: 0,
      spanStartOrdinal: 0,
      spanEndOrdinal: 0,
      preview: 'first request',
    });
    expect(indexed.revision).not.toBe(firstRevision);

    const assistantRevision = indexed.revision;
    await store.updateMessage('assistant-2', { text: 'assistant changed' });
    await expect(
      store.userMessageIndex({ sessionId: 'session-user-index', maximumTicks: 16 }),
    ).resolves.toMatchObject({ revision: assistantRevision });
    store.close();
  });

  it('samples large user-message indexes and preserves bucket spans', async () => {
    const { store } = await openStore('user-index-sampled');
    for (let index = 0; index < 300; index += 1) {
      await store.appendMessage(
        messageInput({
          id: `user-${index}`,
          runtimeGenerationId: 'gen-sampled',
          backendMessageId: `user-${index}`,
          role: 'user',
          text: `request ${index}`,
        }),
      );
    }
    const indexed = await store.userMessageIndex({
      sessionId: 'session-user-index-sampled',
      maximumTicks: 16,
    });
    expect(indexed.mode).toBe('sampled');
    expect(indexed.totalUserMessages).toBe(300);
    expect(indexed.anchors).toHaveLength(16);
    expect(indexed.anchors[0]).toMatchObject({
      messageId: 'user-0',
      spanStartOrdinal: 0,
    });
    expect(indexed.anchors[15]?.spanEndOrdinal).toBe(299);
    store.close();
  });

  it('reads only a bounded preview for oversized user-message anchors', async () => {
    const { store } = await openStore('user-index-oversized');
    await store.appendMessage(
      messageInput({
        id: 'oversized-user',
        runtimeGenerationId: 'gen-oversized',
        backendMessageId: 'oversized-user',
        role: 'user',
        text: `important prefix ${'x'.repeat(100_000)}`,
      }),
    );

    const indexed = await store.userMessageIndex({
      sessionId: 'session-user-index-oversized',
      maximumTicks: 16,
    });
    expect(indexed.anchors).toHaveLength(1);
    expect(indexed.anchors[0]?.preview).toHaveLength(120);
    expect(indexed.anchorBytes).toBeLessThan(1_024);
    store.close();
  });

  it('seeks to an indexed message without loading the full transcript', async () => {
    const { store } = await openStore('transcript-window');
    for (let index = 0; index < 80; index += 1) {
      await store.appendMessage(
        messageInput({
          id: `message-${index}`,
          runtimeGenerationId: 'gen-window',
          backendMessageId: `message-${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: `message ${index}`,
        }),
      );
    }
    const result = await store.transcriptWindow({
      sessionId: 'session-transcript-window',
      anchorMessageId: 'message-40',
      beforeItems: 3,
      afterItems: 4,
      maximumBytes: 64 * 1024,
    });
    expect(result.status).toBe('window');
    if (result.status === 'window') {
      expect(result.messages.map((message) => message.id)).toEqual([
        'message-37',
        'message-38',
        'message-39',
        'message-40',
        'message-41',
        'message-42',
        'message-43',
        'message-44',
      ]);
      expect(result.window.anchorOffset).toBe(3);
    }
    await expect(
      store.transcriptWindow({
        sessionId: 'session-transcript-window',
        anchorMessageId: 'missing',
        beforeItems: 3,
        afterItems: 4,
        maximumBytes: 64 * 1024,
      }),
    ).resolves.toEqual({ status: 'not-found' });
    store.close();
  });

  it('rejects operations after close', async () => {
    const { store } = await openStore('closed');
    store.close();
    await expect(
      store.appendMessage(
        messageInput({
          id: 'piw-m-x',
          runtimeGenerationId: 'gen-a',
          backendMessageId: 'b-1',
        }),
      ),
    ).rejects.toThrow(/closed/);
    await expect(store.count()).rejects.toThrow(/closed/);
  });

  it('persists an idempotent active pause checkpoint and consumes it', async () => {
    const { store } = await openStore('pause-checkpoint');
    const input = {
      sessionId: 'session-pause-checkpoint',
      sourceRunId: 'run-1',
      runtimeGenerationId: 'generation-1',
      createdAt: '2026-08-10T00:00:00.000Z',
      sourceUserMessageId: 'user-1',
      lastAssistantMessageId: 'assistant-1',
      transcriptRevision: 4,
    };
    const created = await store.createPauseCheckpoint(input);
    expect(created).toMatchObject({
      sourceRunId: 'run-1',
      status: 'active',
      transcriptRevision: 4,
    });
    expect(await store.getActivePauseCheckpoint()).toEqual(created);
    expect(await store.createPauseCheckpoint(input)).toEqual(created);
    expect(await store.consumePauseCheckpoint(created.checkpointId)).toBe(true);
    expect(await store.getActivePauseCheckpoint()).toBeUndefined();
    expect(await store.getPauseCheckpoint(created.checkpointId)).toMatchObject({
      checkpointId: created.checkpointId,
      status: 'consumed',
    });
    store.close();
  });

  it('allows replacing an active checkpoint only when its id is retained', async () => {
    const { store } = await openStore('pause-checkpoint-replace');
    const first = await store.createPauseCheckpoint({
      sessionId: 'session-pause-checkpoint-replace',
      sourceRunId: 'run-1',
      createdAt: '2026-08-10T00:00:00.000Z',
      transcriptRevision: 1,
    });
    await expect(
      store.createPauseCheckpoint({
        sessionId: 'session-pause-checkpoint-replace',
        sourceRunId: 'run-2',
        createdAt: '2026-08-10T00:01:00.000Z',
        transcriptRevision: 2,
      }),
    ).rejects.toThrow(/pause-checkpoint-active/);
    const replaced = await store.createPauseCheckpoint({
      checkpointId: first.checkpointId,
      sessionId: 'session-pause-checkpoint-replace',
      sourceRunId: 'run-2',
      createdAt: '2026-08-10T00:01:00.000Z',
      transcriptRevision: 2,
    });
    expect(replaced).toMatchObject({
      checkpointId: first.checkpointId,
      sourceRunId: 'run-2',
      transcriptRevision: 2,
      status: 'active',
    });
    expect(await store.clearPauseCheckpoint(first.checkpointId)).toBe(true);
    expect(await store.getActivePauseCheckpoint()).toBeUndefined();
    store.close();
  });

  it('persists and reopens user contextRefs without rewriting user text', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-context-refs-'));
    const dbPath = join(rootDir, 'transcript.sqlite3');
    const sessionId = 'session-context-refs';
    const store = await openSessionTranscriptStore({
      dbPath,
      sessionId,
      projectPath: '/tmp/project',
    });
    const refs = [
      {
        kind: 'file' as const,
        projectPath: '/tmp/project',
        relativePath: 'src/a.ts',
        lineStart: 2,
        lineEnd: 4,
        label: 'a.ts',
      },
      {
        kind: 'error' as const,
        title: 'TS2322',
        detail: 'Type string is not assignable',
        label: 'err',
      },
    ];
    await store.appendMessage({
      id: 'user-1',
      runtimeGenerationId: USER_AUTHORED_GENERATION,
      backendMessageId: 'user-1',
      role: 'user',
      text: 'please fix this',
      status: 'done',
      createdAt: '2026-08-12T00:00:00.000Z',
      contextRefs: refs,
    });
    const loaded = await store.getMessage('user-1');
    expect(loaded).toMatchObject({ text: 'please fix this', contextRefs: refs });
    const history = await store.buildHistoryWindow({ maxMessages: 10, maxChars: 10_000 });
    expect(history).toEqual([
      expect.objectContaining({ role: 'user', text: 'please fix this', contextRefs: refs }),
    ]);
    store.close();

    const reopened = await openSessionTranscriptStore({
      dbPath,
      sessionId,
      projectPath: '/tmp/project',
    });
    await expect(reopened.getMessage('user-1')).resolves.toMatchObject({
      text: 'please fix this',
      contextRefs: refs,
    });
    reopened.close();
  });

});
