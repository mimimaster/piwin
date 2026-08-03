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
});
