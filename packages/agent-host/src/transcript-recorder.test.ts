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
});
