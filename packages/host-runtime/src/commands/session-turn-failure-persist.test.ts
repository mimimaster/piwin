import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { failedAgentPromptOutcome } from '@piwin/contracts';
import { openSessionTranscriptStore } from '@piwin/session';
import { handleSessionLiveCommand } from './session-live-commands.js';
import { createPromptContext, createSilentSessionHandle } from './session-live-test-context.js';

describe('failed session-turn persistence', () => {
  it('writes a same-run error bubble when the recorder is missing and the store is healthy', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-turn-fail-persist-'));
    const session = createSilentSessionHandle();
    session.prompt = async () =>
      failedAgentPromptOutcome({
        code: 'provider-unavailable',
        origin: 'provider',
        message: 'Connection error.',
        retriable: true,
      });
    const { context, events } = createPromptContext(session);
    const dbPath = join(rootDir, 'transcript.sqlite3');
    const store = await openSessionTranscriptStore({
      dbPath,
      sessionId: session.id,
      projectPath: '/tmp/project',
    });
    await store.appendMessage({
      id: 'assistant-old',
      runtimeGenerationId: 'gen-old',
      backendMessageId: 'a-old',
      role: 'assistant',
      text: 'previous completed reply',
      status: 'done',
      runId: 'run-old',
      createdAt: '2026-09-08T09:25:41.000Z',
      metadata: { outcome: 'completed' },
    });
    context.getTranscriptStore = async () => store;

    const response = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: '这是你干的吗？' } },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });
    const terminal = events.find((event) => event.type === 'run/terminal');
    expect(terminal?.type).toBe('run/terminal');
    if (terminal?.type !== 'run/terminal') {
      throw new Error('missing terminal');
    }
    const runId = terminal.run.runId;
    const failureRow = await store.getMessage(`piw-m-error-${runId}`);
    expect(failureRow).toMatchObject({
      role: 'assistant',
      status: 'error',
      runId,
      outcome: 'failed',
    });
    expect((await store.getMessage('assistant-old'))?.text).toBe('previous completed reply');
    expect((await store.getMessage('assistant-old'))?.outcome).toBe('completed');
    store.close();

    const reopened = await openSessionTranscriptStore({
      dbPath,
      sessionId: session.id,
      projectPath: '/tmp/project',
    });
    expect((await reopened.getMessage(`piw-m-error-${runId}`))?.failure?.message).toBe(
      'Connection error.',
    );
    reopened.close();
  });

  it('writes a same-run error bubble when prompt preparation fails', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-turn-prepare-fail-'));
    const session = createSilentSessionHandle();
    const prompt = vi.fn(async () => {
      throw new Error('live prompt should not run');
    });
    session.prompt = prompt;
    const { context, events } = createPromptContext(session);
    context.buildModelPromptInput = async () => {
      throw new Error('prepare failed');
    };
    const dbPath = join(rootDir, 'transcript.sqlite3');
    const store = await openSessionTranscriptStore({
      dbPath,
      sessionId: session.id,
      projectPath: '/tmp/project',
    });
    await store.appendMessage({
      id: 'assistant-old',
      runtimeGenerationId: 'gen-old',
      backendMessageId: 'a-old',
      role: 'assistant',
      text: 'previous completed reply',
      status: 'done',
      runId: 'run-old',
      createdAt: '2026-09-08T09:25:41.000Z',
      metadata: { outcome: 'completed' },
    });
    context.getTranscriptStore = async () => store;

    const response = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: 'prepare failure' } },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });
    const terminal = events.find((event) => event.type === 'run/terminal');
    expect(terminal?.type).toBe('run/terminal');
    if (terminal?.type !== 'run/terminal') {
      throw new Error('missing terminal');
    }
    const runId = terminal.run.runId;
    expect(terminal.run.status).toBe('failed');
    expect(prompt).not.toHaveBeenCalled();
    expect(await store.getMessage(`piw-m-error-${runId}`)).toMatchObject({
      role: 'assistant',
      status: 'error',
      runId,
      outcome: 'failed',
      failure: { message: 'prepare failed' },
    });
    expect((await store.getMessage('assistant-old'))?.text).toBe('previous completed reply');
    expect((await store.getMessage('assistant-old'))?.outcome).toBe('completed');
    store.close();
  });
});
