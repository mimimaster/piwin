import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listTranscriptMessages } from '@piwin/session';
import { createTranscriptRecorder } from './transcript-recorder.js';

describe('TranscriptRecorder', () => {
  it('serializes concurrent stream events without dropping text or tool updates', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-recorder-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
    });

    await Promise.all([
      recorder.recordEvent({ type: 'message/start', messageId: 'assistant-1', role: 'assistant' }),
      recorder.recordEvent({
        type: 'message/text_delta',
        messageId: 'assistant-1',
        delta: 'Hello ',
      }),
      recorder.recordEvent({ type: 'tool/start', toolCallId: 'tool-1', toolName: 'read' }),
      recorder.recordEvent({
        type: 'message/text_delta',
        messageId: 'assistant-1',
        delta: 'world',
      }),
      recorder.recordEvent({ type: 'tool/update', toolCallId: 'tool-1', delta: 'output' }),
      recorder.recordEvent({ type: 'tool/end', toolCallId: 'tool-1', isError: false }),
      recorder.recordEvent({ type: 'message/end', messageId: 'assistant-1' }),
    ]);
    await recorder.flush();

    const messages = await listTranscriptMessages(transcriptPath);
    const assistant = messages.find((message) => message.id === 'assistant-1');
    expect(assistant?.text).toBe('Hello world');
    expect(assistant?.status).toBe('done');
    expect(assistant?.tools).toEqual([
      { toolCallId: 'tool-1', toolName: 'read', status: 'done', output: 'output' },
    ]);
  });

  it('persists and merges native search evidence in the legacy JSON transcript', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-recorder-search-evidence-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-search-evidence',
      projectPath: '/tmp/project',
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
    await recorder.recordEvent({ type: 'message/end', messageId: 'assistant-search' });
    await recorder.flush();

    const assistant = (await listTranscriptMessages(transcriptPath)).find(
      (message) => message.id === 'assistant-search',
    );
    expect(assistant).toMatchObject({
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
  });

  it('keeps a high-rate delta stream exact with one final snapshot flush', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-recorder-batch-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
      flushIntervalMs: 60_000,
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-1',
      role: 'assistant',
    });
    const deltas = Array.from({ length: 10_000 }, () => 'x');
    await Promise.all(
      deltas.map((delta) =>
        recorder.recordEvent({
          type: 'message/text_delta',
          messageId: 'assistant-1',
          delta,
        }),
      ),
    );
    await recorder.flush();

    const messages = await listTranscriptMessages(transcriptPath);
    expect(messages.find((message) => message.id === 'assistant-1')?.text).toBe('x'.repeat(10_000));
  });

  it('does not persist an empty assistant lifecycle emitted by Pi internal work', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-recorder-empty-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '',
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'empty-assistant',
      role: 'assistant',
    });
    await recorder.recordEvent({ type: 'message/end', messageId: 'empty-assistant' });
    await recorder.flush();

    expect(await listTranscriptMessages(transcriptPath)).toEqual([]);
  });

  it('persists tool/end presentation output when no tool/update was streamed', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-recorder-mcp-end-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-1',
      role: 'assistant',
    });
    await recorder.recordEvent({
      type: 'tool/start',
      toolCallId: 'tool-mcp',
      toolName: 'mcp__agent-memory__agent_memory_get_context',
      presentation: {
        kind: 'mcp',
        title: 'agent-memory / agent_memory_get_context',
        inputPreview: '{"project":"piwin"}',
        actionVerb: 'MCP (agent-memory)',
        summary: '{"project":"piwin"}',
      },
    });
    // Custom MCP tools typically only emit tool/end with AgentToolResult text
    // in presentation.output — no intermediate tool/update deltas.
    await recorder.recordEvent({
      type: 'tool/end',
      toolCallId: 'tool-mcp',
      isError: false,
      presentation: {
        kind: 'mcp',
        title: 'agent-memory / agent_memory_get_context',
        output: { text: '(项目: piwin) 找到 2 条记忆' },
      },
    });
    await recorder.recordEvent({ type: 'message/end', messageId: 'assistant-1' });
    await recorder.flush();

    const messages = await listTranscriptMessages(transcriptPath);
    const tool = messages.find((message) => message.id === 'assistant-1')?.tools?.[0];
    expect(tool?.status).toBe('done');
    expect(tool?.output).toBe('(项目: piwin) 找到 2 条记忆');
    expect(tool?.presentation?.output?.text).toBe('(项目: piwin) 找到 2 条记忆');
  });

  it('persists generated media attachments on the assistant message', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-recorder-image-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-1',
      role: 'assistant',
      runId: 'run-1',
    });
    await recorder.recordEvent({
      type: 'tool/start',
      toolCallId: 'tool-image',
      toolName: 'image_gen',
      runId: 'run-1',
    });
    await recorder.recordEvent({
      type: 'tool/end',
      toolCallId: 'tool-image',
      isError: false,
      runId: 'run-1',
      attachments: [
        {
          id: 'asset-1',
          kind: 'media',
          path: '/tmp/.piwin/media/session-1/asset-1.png',
          mimeType: 'image/png',
          byteSize: 256,
          source: 'generated',
        },
      ],
    });
    await recorder.recordEvent({ type: 'message/end', messageId: 'assistant-1', runId: 'run-1' });
    await recorder.flush();

    const messages = await listTranscriptMessages(transcriptPath);
    expect(messages.find((message) => message.id === 'assistant-1')?.attachments).toEqual([
      {
        id: 'asset-1',
        kind: 'media',
        path: '/tmp/.piwin/media/session-1/asset-1.png',
        mimeType: 'image/png',
        byteSize: 256,
        source: 'generated',
      },
    ]);
  });

  it('retains a bounded tool output with a visible truncation marker', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-recorder-tool-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
      maxToolOutputBytes: 64,
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-1',
      role: 'assistant',
    });
    await recorder.recordEvent({ type: 'tool/start', toolCallId: 'tool-1', toolName: 'bash' });
    await Promise.all(
      Array.from({ length: 100 }, () =>
        recorder.recordEvent({
          type: 'tool/update',
          toolCallId: 'tool-1',
          delta: '0123456789abcdef',
        }),
      ),
    );
    await recorder.flush();

    const messages = await listTranscriptMessages(transcriptPath);
    const output = messages.find((message) => message.id === 'assistant-1')?.tools?.[0]?.output;
    expect(output).toContain('[output truncated: retention limit reached]');
    expect(Buffer.byteLength(output ?? '', 'utf8')).toBeLessThanOrEqual(64);
  });

  it('dispose abandons pending flushes so truncate cannot be overwritten', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-recorder-dispose-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
      flushIntervalMs: 60_000,
    });

    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'assistant-1',
      role: 'assistant',
    });
    await recorder.recordEvent({
      type: 'message/text_delta',
      messageId: 'assistant-1',
      delta: 'stale',
    });
    // Simulate truncate: external writer cut the file, then dispose the old recorder.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      transcriptPath,
      JSON.stringify({
        version: 1,
        sessionId: 'session-1',
        projectPath: '/tmp/project',
        messages: [],
        updatedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    recorder.dispose();
    await recorder.flush();

    expect(await listTranscriptMessages(transcriptPath)).toEqual([]);
  });

  it('honors clientMessageId for user turns so Desktop Revert can match live bubble ids', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-client-id-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
    });

    const clientMessageId = 'client-bubble-abc123';
    await recorder.recordUserPrompt({
      text: 'please fix the revert button',
      clientMessageId,
    });
    await recorder.flush();

    const messages = await listTranscriptMessages(transcriptPath);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(clientMessageId);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.text).toBe('please fix the revert button');
  });

  it('generates a host user id when clientMessageId is omitted', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-host-id-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
    });

    await recorder.recordUserPrompt({ text: 'hello from cli' });
    await recorder.flush();

    const messages = await listTranscriptMessages(transcriptPath);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id.startsWith('user-')).toBe(true);
  });

  it('reports deltas targeting an unknown message via onDiagnostic', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-recorder-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const diagnostics: string[] = [];
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
      onDiagnostic: (message) => diagnostics.push(message),
    });

    // A text delta arrives before its message/start (or for a message the
    // recorder never saw) — this is the "model output generated but never
    // persisted" case. It must be surfaced, not silently dropped.
    await recorder.recordEvent({
      type: 'message/text_delta',
      messageId: 'assistant-missing',
      delta: 'the model answered but it never landed',
    });
    await recorder.flush();

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]).toContain('text_delta');
    expect(diagnostics[0]).toContain('assistant-missing');

    const messages = await listTranscriptMessages(transcriptPath);
    expect(messages).toHaveLength(0);
  });

  it('records generation provenance and treats same-generation replay as idempotent', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-provenance-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
      runtimeGenerationId: 'gen-a',
    });

    // SDK subscription recovery replays lifecycle events within one generation.
    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'piw-m-replay',
      role: 'assistant',
    });
    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'piw-m-replay',
      role: 'assistant',
    });
    await recorder.recordEvent({
      type: 'message/text_delta',
      messageId: 'piw-m-replay',
      delta: 'replayed answer',
    });
    await recorder.recordEvent({ type: 'message/end', messageId: 'piw-m-replay' });
    await recorder.flush();

    const messages = await listTranscriptMessages(transcriptPath);
    const rows = messages.filter((message) => message.role === 'assistant');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('piw-m-replay');
    expect(rows[0]?.text).toBe('replayed answer');
    expect(rows[0]?.runtimeGenerationId).toBe('gen-a');
  });

  it('emits a bounded diagnostic and never mutates the older row on cross-generation collision', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-transcript-collision-'));
    const transcriptPath = join(rootDir, 'transcript.json');
    const { writeFile } = await import('node:fs/promises');
    // A prior generation persisted an assistant row under the same naked id.
    await writeFile(
      transcriptPath,
      JSON.stringify({
        version: 1,
        sessionId: 'session-1',
        projectPath: '/tmp/project',
        messages: [
          {
            id: 'piw-m-collide',
            role: 'assistant',
            text: 'older generation answer',
            createdAt: new Date().toISOString(),
            status: 'done',
            runtimeGenerationId: 'gen-old',
          },
        ],
        updatedAt: new Date().toISOString(),
      }),
      'utf8',
    );

    const diagnostics: string[] = [];
    const recorder = createTranscriptRecorder({
      transcriptPath,
      sessionId: 'session-1',
      projectPath: '/tmp/project',
      runtimeGenerationId: 'gen-new',
      onDiagnostic: (message) => diagnostics.push(message),
    });

    // The reconstructed generation emits the same backend row id. Normalized
    // ids are generation-scoped so this can only be an anomaly — the older row
    // must survive untouched and the collision is surfaced, never merged.
    await recorder.recordEvent({
      type: 'message/start',
      messageId: 'piw-m-collide',
      role: 'assistant',
      runId: 'run-new',
    });
    await recorder.recordEvent({
      type: 'message/text_delta',
      messageId: 'piw-m-collide',
      delta: ' must not be appended',
      runId: 'run-new',
    });
    await recorder.recordEvent({
      type: 'tool/start',
      toolCallId: 'piw-t-collide',
      toolName: 'read',
      runId: 'run-new',
    });
    await recorder.recordEvent({
      type: 'message/end',
      messageId: 'piw-m-collide',
      runId: 'run-new',
    });
    await recorder.flush();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('message/start collision');
    expect(diagnostics[0]).toContain('gen-old');
    expect(diagnostics[0]).toContain('gen-new');

    const messages = await listTranscriptMessages(transcriptPath);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe('piw-m-collide');
    expect(messages[0]?.text).toBe('older generation answer');
    expect(messages[0]?.runtimeGenerationId).toBe('gen-old');
    expect(messages[0]?.tools).toBeUndefined();
    expect(messages[0]?.status).toBe('done');
  });
});
