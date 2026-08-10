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

  it('persists and merges native search evidence before assistant finalization', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-search-evidence-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-search-evidence',
      projectPath: '/project',
    });
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-search-evidence',
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-search',
      role: 'assistant',
    });
    await recorder.recordEvent({
      type: 'message/search_evidence',
      messageId: 'assistant-search',
      evidence: {
        query: 'piwin',
        provenance: 'native',
        citations: [{ title: 'First', url: 'https://example.com/a', provenance: 'native' }],
      },
    });
    await recorder.recordEvent({
      type: 'message/search_evidence',
      messageId: 'assistant-search',
      evidence: {
        query: 'changed query',
        provenance: 'native',
        citations: [
          { title: 'Changed', url: 'HTTPS://EXAMPLE.COM/a', provenance: 'native' },
          { title: 'Second', url: 'https://example.com/b', provenance: 'native' },
        ],
      },
    });
    await recorder.recordEvent({
      type: 'message/end',
      messageId: 'assistant-search',
    });
    await recorder.flush();

    expect(await store.getMessage('assistant-search')).toMatchObject({
      status: 'done',
      searchEvidence: {
        query: 'piwin',
        provenance: 'native',
        citations: [
          { title: 'First', url: 'https://example.com/a', provenance: 'native' },
          { title: 'Second', url: 'https://example.com/b', provenance: 'native' },
        ],
      },
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
