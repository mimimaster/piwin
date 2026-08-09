import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSessionTranscriptStore } from '@piwin/session';
import { createStoreTranscriptRecorder } from './store-transcript-recorder.js';

describe('createStoreTranscriptRecorder', () => {
  it('persists only row-level user, assistant, and tool mutations', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-1',
      projectPath: '/project',
    });
    await store.markAuthoritative();
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-1',
    });
    await recorder.recordUserPrompt({ text: 'hello', clientMessageId: 'user-1' });
    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'product-assistant-1',
      backendMessageId: 'backend-assistant-1',
      role: 'assistant',
      runId: 'run-1',
    });
    await recorder.recordEvent({
      type: 'message/text_delta',
      messageId: 'product-assistant-1',
      delta: 'answer',
      runId: 'run-1',
    });
    await recorder.recordEvent({
      type: 'tool/start',
      toolCallId: 'tool-1',
      toolName: 'read',
      runId: 'run-1',
    });
    await recorder.recordEvent({
      type: 'tool/end',
      toolCallId: 'tool-1',
      isError: false,
      runId: 'run-1',
      presentation: { kind: 'filesystem', title: 'Read file', output: { text: 'tool result' } },
    });
    await recorder.recordEvent({
      type: 'message/end',
      messageId: 'product-assistant-1',
      runId: 'run-1',
    });
    await recorder.flush();

    expect(await store.count()).toBe(2);
    expect(await store.getMessage('product-assistant-1')).toMatchObject({
      text: 'answer',
      status: 'done',
      runtimeGenerationId: 'generation-1',
      tools: [{ toolCallId: 'tool-1', output: 'tool result', status: 'done' }],
    });
    recorder.dispose();
    store.close();
  });

  it('quarantines a normalized-id/provenance collision', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-collision-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-2',
      projectPath: '/project',
    });
    await store.appendMessage({
      id: 'product-original',
      runtimeGenerationId: 'generation-1',
      backendMessageId: 'backend-shared',
      role: 'assistant',
      text: 'original',
      status: 'done',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    const diagnostics: string[] = [];
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-1',
      onDiagnostic: (message) => diagnostics.push(message),
    });
    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'product-different',
      backendMessageId: 'backend-shared',
      role: 'assistant',
    });
    await recorder.recordEvent({
      type: 'message/text_delta',
      messageId: 'product-different',
      delta: 'must not land',
    });
    expect(await store.count()).toBe(1);
    expect((await store.getMessage('product-original'))?.text).toBe('original');
    expect(diagnostics.some((message) => message.includes('identity collision'))).toBe(true);
    recorder.dispose();
    store.close();
  });
});
