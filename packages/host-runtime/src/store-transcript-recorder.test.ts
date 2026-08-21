import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openSessionTranscriptStore } from '@piwin/session';
import { createStoreTranscriptRecorder } from './store-transcript-recorder.js';

describe('createStoreTranscriptRecorder', () => {
  it('persists native context entries onto the owning assistant row', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-native-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-native',
      projectPath: '/project',
    });
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-native',
    });

    try {
      await recorder.recordEvent({
        type: 'message/start',
        messageId: 'assistant-native',
        role: 'assistant',
      });
      await recorder.recordEvent({
        type: 'message/text_delta',
        messageId: 'assistant-native',
        delta: 'running a tool',
      });
      await recorder.recordEvent({
        type: 'message/end',
        messageId: 'assistant-native',
      });
      await recorder.recordEvent({
        type: 'message/native_context',
        messageId: 'assistant-native',
        role: 'assistant',
        entry: {
          format: 'pi-message-v1',
          payload: '{"role":"assistant"}',
          byteLength: 20,
        },
      });
      // toolResult copies attach to the owning assistant row after its end.
      await recorder.recordEvent({
        type: 'message/native_context',
        messageId: 'tool-result-native',
        role: 'toolResult',
        responseMessageId: 'assistant-native',
        entry: {
          format: 'pi-message-v1',
          payload: '{"role":"toolResult"}',
          byteLength: 21,
        },
      });
      await recorder.flush();

      const entries = await store.readNativeEntries('assistant-native');
      expect(
        entries.map((entry) => (JSON.parse(entry.payload) as { role: string }).role),
      ).toEqual(['assistant', 'toolResult']);
    } finally {
      recorder.dispose();
      store.close();
    }
  });

  it('drops native context for quarantined or unknown targets', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-native-drop-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-native-drop',
      projectPath: '/project',
    });
    const diagnostics: string[] = [];
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-native-drop',
      onDiagnostic: (message) => diagnostics.push(message),
    });

    try {
      // toolResult with no owning assistant anywhere: dropped with diagnostic.
      await recorder.recordEvent({
        type: 'message/native_context',
        messageId: 'orphan-tool-result',
        role: 'toolResult',
        entry: { format: 'pi-message-v1', payload: '{}', byteLength: 2 },
      });
      await recorder.flush();
      expect(diagnostics.some((line) => line.includes('native_context dropped'))).toBe(true);
    } finally {
      recorder.dispose();
      store.close();
    }
  });

  it('persists the reasoning interval and closes it when tool work starts', async () => {
    vi.useFakeTimers();
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-thinking-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-thinking',
      projectPath: '/project',
    });
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-thinking',
    });

    try {
      await recorder.recordEvent({
        type: 'message/start',
        messageId: 'assistant-thinking',
        role: 'assistant',
        runId: 'run-thinking',
      });
      vi.setSystemTime('2026-08-12T08:00:01.000Z');
      await recorder.recordEvent({
        type: 'message/thinking_delta',
        messageId: 'assistant-thinking',
        delta: 'reasoning',
        runId: 'run-thinking',
      });
      vi.setSystemTime('2026-08-12T08:00:05.000Z');
      await recorder.recordEvent({
        type: 'tool/start',
        toolCallId: 'tool-thinking',
        toolName: 'read',
        runId: 'run-thinking',
      });
      vi.setSystemTime('2026-08-12T08:28:28.000Z');
      await recorder.recordEvent({
        type: 'message/end',
        messageId: 'assistant-thinking',
        runId: 'run-thinking',
      });
      await recorder.flush();

      await expect(store.getMessage('assistant-thinking')).resolves.toMatchObject({
        thinkingStartedAt: '2026-08-12T08:00:01.000Z',
        thinkingEndedAt: '2026-08-12T08:00:05.000Z',
      });
    } finally {
      recorder.dispose();
      store.close();
      vi.useRealTimers();
    }
  });

  it('closes persisted reasoning when the session is aborted', async () => {
    vi.useFakeTimers();
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-abort-thinking-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-abort-thinking',
      projectPath: '/project',
    });
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-abort-thinking',
    });

    try {
      await recorder.recordEvent({
        type: 'message/start',
        messageId: 'assistant-abort-thinking',
        role: 'assistant',
        runId: 'run-abort-thinking',
      });
      vi.setSystemTime('2026-08-12T08:00:01.000Z');
      await recorder.recordEvent({
        type: 'message/thinking_delta',
        messageId: 'assistant-abort-thinking',
        delta: 'reasoning',
        runId: 'run-abort-thinking',
      });
      vi.setSystemTime('2026-08-12T08:00:03.000Z');
      await recorder.recordEvent({
        type: 'session/aborted',
        sessionId: 'session-abort-thinking',
        messageId: 'assistant-abort-thinking',
        runId: 'run-abort-thinking',
      });
      await recorder.flush();

      await expect(store.getMessage('assistant-abort-thinking')).resolves.toMatchObject({
        status: 'done',
        thinkingStartedAt: '2026-08-12T08:00:01.000Z',
        thinkingEndedAt: '2026-08-12T08:00:03.000Z',
      });
    } finally {
      recorder.dispose();
      store.close();
      vi.useRealTimers();
    }
  });

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

  it('merges workspaceWrites into the assistant row on write-like tool/end', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-writes-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-writes',
      projectPath: '/project',
    });
    await store.markAuthoritative();
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-writes',
    });
    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-write',
      role: 'assistant',
      runId: 'run-write',
    });
    await recorder.recordEvent({
      type: 'tool/start',
      toolCallId: 'edit-1',
      toolName: 'edit',
      runId: 'run-write',
    });
    await recorder.recordEvent({
      type: 'tool/end',
      toolCallId: 'edit-1',
      isError: false,
      runId: 'run-write',
      presentation: {
        kind: 'filesystem',
        title: 'Edit file',
        actionVerb: 'Edited',
        targetPaths: ['src/app.ts'],
      },
    });
    await recorder.recordEvent({
      type: 'message/end',
      messageId: 'assistant-write',
      runId: 'run-write',
    });
    await recorder.flush();
    expect((await store.getMessage('assistant-write'))?.workspaceWrites).toEqual({
      files: ['src/app.ts'],
      hasUnknownWrites: false,
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

  it('persists Pi tool events that arrive after the owning message ends', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-pi-order-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-pi-order',
      projectPath: '/project',
    });
    await store.markAuthoritative();
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-pi-order',
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'product-assistant-pi-order',
      backendMessageId: 'backend-assistant-pi-order',
      role: 'assistant',
      runId: 'run-pi-order',
    });
    await recorder.recordEvent({
      type: 'message/text_delta',
      messageId: 'product-assistant-pi-order',
      delta: 'I will inspect the workspace.',
      runId: 'run-pi-order',
    });
    // Pi closes the Assistant message carrying the tool call before it emits
    // tool_execution_start/tool_execution_end for that call.
    await recorder.recordEvent({
      type: 'message/end',
      messageId: 'product-assistant-pi-order',
      runId: 'run-pi-order',
    });
    await recorder.recordEvent({
      type: 'tool/start',
      toolCallId: 'tool-after-message-end',
      toolName: 'bash',
      runId: 'run-pi-order',
    });
    await recorder.recordEvent({
      type: 'tool/end',
      toolCallId: 'tool-after-message-end',
      isError: false,
      runId: 'run-pi-order',
      presentation: {
        kind: 'shell',
        title: 'Run command',
        output: { text: 'command output' },
      },
    });
    await recorder.flush();

    expect(await store.getMessage('product-assistant-pi-order')).toMatchObject({
      status: 'done',
      tools: [
        {
          toolCallId: 'tool-after-message-end',
          toolName: 'bash',
          status: 'done',
          output: 'command output',
        },
      ],
    });
    recorder.dispose();
    store.close();
  });

  it('uses explicit responseMessageId instead of the latest assistant fallback', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-response-id-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-response-id',
      projectPath: '/project',
    });
    await store.markAuthoritative();
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-response-id',
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-first',
      role: 'assistant',
      runId: 'run-first',
    });
    await recorder.recordEvent({
      type: 'message/text_delta',
      messageId: 'assistant-first',
      delta: 'first response',
      runId: 'run-first',
    });
    await recorder.recordEvent({
      type: 'message/end',
      messageId: 'assistant-first',
      runId: 'run-first',
    });
    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-latest',
      role: 'assistant',
      runId: 'run-latest',
    });
    await recorder.recordEvent({
      type: 'message/text_delta',
      messageId: 'assistant-latest',
      delta: 'latest response',
      runId: 'run-latest',
    });
    await recorder.recordEvent({
      type: 'message/end',
      messageId: 'assistant-latest',
      runId: 'run-latest',
    });

    await recorder.recordEvent({
      type: 'tool/start',
      toolCallId: 'tool-first-after-end',
      toolName: 'read',
      runId: 'run-first',
      responseMessageId: 'assistant-first',
    });
    await recorder.recordEvent({
      type: 'tool/end',
      toolCallId: 'tool-first-after-end',
      isError: false,
      runId: 'run-first',
      responseMessageId: 'assistant-first',
      presentation: { kind: 'filesystem', title: 'Read file', output: { text: 'contents' } },
    });
    await recorder.flush();

    expect(await store.getMessage('assistant-first')).toMatchObject({
      tools: [
        {
          toolCallId: 'tool-first-after-end',
          responseMessageId: 'assistant-first',
          status: 'done',
        },
      ],
    });
    expect(await store.getMessage('assistant-latest')).toMatchObject({ tools: [] });
    recorder.dispose();
    store.close();
  });

  it('persists routed generation semantics, prompt metadata, and generated attachments', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-routed-image-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-routed-image',
      projectPath: '/project',
    });
    await store.markAuthoritative();
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-routed-image',
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-routed-image',
      role: 'assistant',
      runId: 'run-routed-image',
    });
    await recorder.recordEvent({
      type: 'tool/start',
      toolCallId: 'tool-routed-image',
      toolName: 'piwin_toolbox',
      responseMessageId: 'assistant-routed-image',
      runId: 'run-routed-image',
      presentation: {
        kind: 'image',
        title: 'image_gen',
        routedToolName: 'image_gen',
        actionVerb: 'Generated image',
        summary: 'cinematic wasteland portrait',
        inputPreview: '{"prompt":"cinematic wasteland portrait"}',
      },
    });
    await recorder.recordEvent({
      type: 'tool/update',
      toolCallId: 'tool-routed-image',
      delta: '{"progress":50}',
      responseMessageId: 'assistant-routed-image',
      runId: 'run-routed-image',
      presentation: {
        kind: 'image',
        title: 'image_gen',
        routedToolName: 'image_gen',
        actionVerb: 'Generated image',
        summary: 'cinematic wasteland portrait',
        inputPreview: '{"prompt":"cinematic wasteland portrait"}',
        output: { text: '{"progress":50}' },
      },
    });
    await recorder.recordEvent({
      type: 'tool/end',
      toolCallId: 'tool-routed-image',
      isError: false,
      responseMessageId: 'assistant-routed-image',
      runId: 'run-routed-image',
      presentation: {
        kind: 'image',
        title: 'image_gen',
        routedToolName: 'image_gen',
        actionVerb: 'Generated image',
        summary: 'cinematic wasteland portrait',
        inputPreview: '{"prompt":"cinematic wasteland portrait"}',
        output: { text: '{"paths":["/tmp/generated.png"]}' },
      },
      attachments: [
        {
          id: 'asset-routed-image',
          kind: 'media',
          path: '/tmp/generated.png',
          mimeType: 'image/png',
          byteSize: 256,
          source: 'generated',
        },
      ],
    });
    await recorder.recordEvent({
      type: 'message/end',
      messageId: 'assistant-routed-image',
      runId: 'run-routed-image',
    });
    await recorder.flush();

    expect(await store.getMessage('assistant-routed-image')).toMatchObject({
      attachments: [{ id: 'asset-routed-image', path: '/tmp/generated.png' }],
      tools: [
        {
          toolName: 'piwin_toolbox',
          status: 'done',
          output: '{"paths":["/tmp/generated.png"]}',
          presentation: {
            kind: 'image',
            title: 'image_gen',
            routedToolName: 'image_gen',
            summary: 'cinematic wasteland portrait',
            inputPreview: '{"prompt":"cinematic wasteland portrait"}',
          },
        },
      ],
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

  it('does not attach tools to a quarantined response message', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-tool-quarantine-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-tool-quarantine',
      projectPath: '/project',
    });
    await store.appendMessage({
      id: 'shared-product-message',
      runtimeGenerationId: 'generation-old',
      backendMessageId: 'backend-old',
      role: 'assistant',
      text: 'older response',
      status: 'done',
      createdAt: '2026-08-09T00:00:00.000Z',
      tools: [],
    });
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-new',
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'shared-product-message',
      backendMessageId: 'backend-new',
      role: 'assistant',
    });
    await recorder.recordEvent({
      type: 'tool/start',
      toolCallId: 'must-not-attach',
      toolName: 'read',
      responseMessageId: 'shared-product-message',
    });
    await recorder.flush();

    expect(await store.getMessage('shared-product-message')).toMatchObject({
      text: 'older response',
      runtimeGenerationId: 'generation-old',
      tools: [],
    });
    recorder.dispose();
    store.close();
  });

  it('persists a synthetic error bubble when the provider fails with no assistant row', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-silent-error-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-silent-error',
      projectPath: '/project',
    });
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-silent-error',
    });

    try {
      await recorder.recordUserPrompt({ text: 'ping' });
      await recorder.recordEvent({
        type: 'error',
        message: 'No endpoints available matching your guardrail',
        retriable: true,
        runId: 'run-silent',
      });
      await recorder.flush();

      const messages = await store.listTail(10);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', text: 'ping' }),
          expect.objectContaining({
            role: 'assistant',
            status: 'error',
            terminalMessage: 'No endpoints available matching your guardrail',
            outcome: 'failed',
            runId: 'run-silent',
          }),
        ]),
      );
    } finally {
      recorder.dispose();
      store.close();
    }
  });

  it('does not prune an empty assistant after it is marked as a failed generation', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-keep-error-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-keep-error',
      projectPath: '/project',
    });
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-keep-error',
    });

    try {
      await recorder.recordEvent({
        type: 'message/start',
        messageId: 'assistant-empty',
        role: 'assistant',
        runId: 'run-empty',
      });
      await recorder.recordEvent({
        type: 'message/end',
        messageId: 'assistant-empty',
        runId: 'run-empty',
      });
      await recorder.recordEvent({
        type: 'error',
        message: 'provider 404',
        runId: 'run-empty',
      });
      await recorder.flush();

      expect(await store.getMessage('assistant-empty')).toMatchObject({
        status: 'error',
        terminalMessage: 'provider 404',
        outcome: 'failed',
      });
    } finally {
      recorder.dispose();
      store.close();
    }
  });
});
