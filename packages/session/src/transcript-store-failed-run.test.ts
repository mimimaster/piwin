import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSessionTranscriptStore } from './transcript-store.js';

const FAILURE = {
  code: 'unknown-agent-failure' as const,
  origin: 'runtime' as const,
  message: 'Unexpected non-whitespace character after JSON',
  retriable: false,
};

describe('SessionTranscriptStore.ensureFailedRunAssistant', () => {
  it('inserts a Host error bubble for a run that never got an assistant, and survives reopen', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-failed-run-insert-'));
    const dbPath = join(rootDir, 'transcript.sqlite3');
    const store = await openSessionTranscriptStore({
      dbPath,
      sessionId: 'session-failed-run',
      projectPath: '/tmp/project',
    });
    await store.appendMessage({
      id: 'assistant-old',
      runtimeGenerationId: 'gen-old',
      backendMessageId: 'a-old',
      role: 'assistant',
      text: 'hard-fix report',
      status: 'done',
      runId: 'run-old',
      createdAt: '2026-09-08T09:25:41.000Z',
      metadata: { outcome: 'completed' },
    });
    await store.appendMessage({
      id: 'user-new',
      runtimeGenerationId: 'user-authored',
      backendMessageId: 'u-new',
      role: 'user',
      text: '这是你干的吗？',
      status: 'done',
      createdAt: '2026-09-08T09:27:13.000Z',
    });

    const ensured = await store.ensureFailedRunAssistant({
      runId: 'run-new',
      updatedAt: '2026-09-08T09:27:14.000Z',
      terminalMessage: FAILURE.message,
      failure: FAILURE,
    });
    expect(ensured).toMatchObject({
      id: 'piw-m-error-run-new',
      role: 'assistant',
      status: 'error',
      runId: 'run-new',
      outcome: 'failed',
      failure: FAILURE,
    });
    expect((await store.getMessage('assistant-old'))?.outcome).toBe('completed');
    expect((await store.getMessage('assistant-old'))?.failure).toBeUndefined();
    store.close();

    const reopened = await openSessionTranscriptStore({
      dbPath,
      sessionId: 'session-failed-run',
      projectPath: '/tmp/project',
    });
    const persisted = await reopened.getMessage('piw-m-error-run-new');
    expect(persisted).toMatchObject({
      runId: 'run-new',
      status: 'error',
      outcome: 'failed',
      failure: FAILURE,
    });
    expect((await reopened.getMessage('assistant-old'))?.text).toBe('hard-fix report');
    reopened.close();
  });

  it('patches the latest same-run assistant instead of inserting a second bubble', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-failed-run-patch-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-failed-run-patch',
      projectPath: '/tmp/project',
    });
    await store.appendMessage({
      id: 'assistant-live',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a-live',
      role: 'assistant',
      text: 'partial',
      status: 'streaming',
      runId: 'run-new',
      createdAt: '2026-09-08T09:27:14.000Z',
    });
    const ensured = await store.ensureFailedRunAssistant({
      runId: 'run-new',
      updatedAt: '2026-09-08T09:27:15.000Z',
      terminalMessage: 'provider 404',
      failure: {
        code: 'provider-http-error',
        origin: 'provider',
        message: 'provider 404',
        retriable: true,
        httpStatus: 404,
      },
    });
    expect(ensured.id).toBe('assistant-live');
    expect(ensured.status).toBe('error');
    expect(ensured.text).toBe('partial');
    const again = await store.ensureFailedRunAssistant({
      runId: 'run-new',
      updatedAt: '2026-09-08T09:27:16.000Z',
      terminalMessage: 'provider 404',
      failure: {
        code: 'provider-http-error',
        origin: 'provider',
        message: 'provider 404',
        retriable: true,
        httpStatus: 404,
      },
    });
    expect(again.id).toBe('assistant-live');
    store.close();
  });
});
