import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { USER_AUTHORED_GENERATION, openSessionTranscriptStore } from './transcript-store.js';

async function openStore(label: string) {
  const rootDir = await mkdtemp(join(tmpdir(), `piwin-queued-leaf-${label}-`));
  const store = await openSessionTranscriptStore({
    dbPath: join(rootDir, 'transcript.sqlite3'),
    sessionId: `session-${label}`,
    projectPath: '/tmp/project',
  });
  return store;
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

describe('SessionTranscriptStore queued-turn leaf', () => {
  it('does not let a pending queued row steal the in-flight reply leaf', async () => {
    const store = await openStore('preserve');
    await store.appendMessage(
      messageInput({
        id: 'user-1',
        runtimeGenerationId: USER_AUTHORED_GENERATION,
        backendMessageId: 'user-1',
        role: 'user',
        text: 'start',
      }),
    );
    await store.appendMessage(
      messageInput({
        id: 'asst-1',
        runtimeGenerationId: 'gen-1',
        backendMessageId: 'asst-1',
        text: 'partial',
      }),
    );
    expect(await store.getActiveLeaf()).toBe('asst-1');

    const created = await store.createQueuedTurn({
      queuedTurnId: 'queued-1',
      sessionId: 'session-preserve',
      userMessageId: 'queued-user',
      mode: 'next',
      input: { text: 'do this next' },
      fingerprint: 'fp-1',
      submittedAt: '2026-09-18T17:34:00.000Z',
    });
    expect(created).toMatchObject({ outcome: 'created' });
    expect(await store.getActiveLeaf()).toBe('asst-1');
    expect(await store.getParentMessageId('queued-user')).toBe('asst-1');

    await store.appendMessage(
      messageInput({
        id: 'asst-2',
        runtimeGenerationId: 'gen-1',
        backendMessageId: 'asst-2',
        text: 'more',
      }),
    );
    expect(await store.getActiveLeaf()).toBe('asst-2');
    expect(await store.getParentMessageId('asst-2')).toBe('asst-1');
    expect(await store.listBranchPoints({ previewChars: 40 })).toEqual([]);

    const starting = await store.transitionQueuedTurn({
      queuedTurnId: 'queued-1',
      expectedRevision: 1,
      from: ['pending'],
      to: 'starting',
      updatedAt: '2026-09-18T17:37:04.000Z',
    });
    expect(starting).toMatchObject({ status: 'starting' });
    expect(await store.getActiveLeaf()).toBe('queued-user');
    expect(await store.getParentMessageId('queued-user')).toBe('asst-2');
    store.close();
  });

  it('attaches a converted queued row onto the current leaf', async () => {
    const store = await openStore('convert-leaf');
    await store.appendMessage(
      messageInput({
        id: 'user-1',
        runtimeGenerationId: USER_AUTHORED_GENERATION,
        backendMessageId: 'user-1',
        role: 'user',
        text: 'start',
      }),
    );
    await store.appendMessage(
      messageInput({
        id: 'asst-1',
        runtimeGenerationId: 'gen-1',
        backendMessageId: 'asst-1',
        text: 'partial',
      }),
    );
    await store.createQueuedTurn({
      queuedTurnId: 'queued-1',
      sessionId: 'session-convert-leaf',
      userMessageId: 'queued-user',
      mode: 'next',
      input: { text: 'steer instead' },
      fingerprint: 'fp-1',
      submittedAt: '2026-09-18T17:34:00.000Z',
    });
    await store.appendMessage(
      messageInput({
        id: 'asst-2',
        runtimeGenerationId: 'gen-1',
        backendMessageId: 'asst-2',
        text: 'more',
      }),
    );

    const converted = await store.convertQueuedTurnToIntervention({
      queuedTurnId: 'queued-1',
      expectedRevision: 1,
      interventionId: 'intervention-1',
      runId: 'run-1',
      runtimeGenerationId: 'gen-1',
      userMessageId: 'queued-user',
      input: { text: 'steer instead' },
      preparedText: 'steer instead',
      fingerprint: 'intervention-fp-1',
      updatedAt: '2026-09-18T17:35:00.000Z',
    });
    expect(converted).toMatchObject({ outcome: 'converted' });
    expect(await store.getActiveLeaf()).toBe('queued-user');
    expect(await store.getParentMessageId('queued-user')).toBe('asst-2');
    store.close();
  });
});
