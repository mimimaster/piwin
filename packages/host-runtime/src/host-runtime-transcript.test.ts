import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openSessionTranscriptStore } from '@piwin/session';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { ensureTranscriptRecorder } from './host-runtime-transcript.js';
import type { TranscriptRecorder } from './transcript-recorder.js';

describe('ensureTranscriptRecorder', () => {
  it('flushes and replaces the recorder when the runtime generation changes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-runtime-transcript-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-generation-switch',
      projectPath: '/project',
    });
    const transcriptRecorders = new Map<string, TranscriptRecorder>();
    const deps = {
      transcriptRecorders,
      transcriptStores: { get: vi.fn(async () => store) },
      sessionModels: new Map(),
      push: vi.fn(),
    } as unknown as HostRuntimeKernel;

    try {
      await ensureTranscriptRecorder(
        deps,
        'session-generation-switch',
        '/project',
        'generation-old',
      );
      const oldRecorder = transcriptRecorders.get('session-generation-switch');
      if (oldRecorder === undefined) throw new Error('old recorder was not created');

      // Leave the old turn dirty in memory. Rebinding must flush it before
      // replacing the recorder, otherwise a runtime switch loses its tail.
      await oldRecorder.recordEvent({
        type: 'message/start',
        messageId: 'assistant-old',
        backendMessageId: 'backend-restarted',
        role: 'assistant',
      });
      await oldRecorder.recordEvent({
        type: 'message/text_delta',
        messageId: 'assistant-old',
        delta: 'old output',
      });
      await oldRecorder.recordEvent({
        type: 'message/end',
        messageId: 'assistant-old',
      });

      await ensureTranscriptRecorder(
        deps,
        'session-generation-switch',
        '/project',
        'generation-new',
      );
      const newRecorder = transcriptRecorders.get('session-generation-switch');
      if (newRecorder === undefined) throw new Error('new recorder was not created');
      expect(newRecorder).not.toBe(oldRecorder);
      expect(await store.getMessage('assistant-old')).toMatchObject({
        text: 'old output',
        status: 'done',
        runtimeGenerationId: 'generation-old',
      });

      // Backend message ids can restart in a new generation. The replacement
      // recorder must stamp the new provenance so this is a new durable row.
      await newRecorder.recordEvent({
        type: 'message/start',
        messageId: 'assistant-new',
        backendMessageId: 'backend-restarted',
        role: 'assistant',
      });
      await newRecorder.recordEvent({
        type: 'message/text_delta',
        messageId: 'assistant-new',
        delta: 'new output',
      });
      await newRecorder.recordEvent({
        type: 'message/end',
        messageId: 'assistant-new',
      });
      await newRecorder.flush();

      expect(await store.getMessage('assistant-new')).toMatchObject({
        text: 'new output',
        status: 'done',
        runtimeGenerationId: 'generation-new',
      });
    } finally {
      for (const recorder of transcriptRecorders.values()) recorder.dispose();
      store.close();
    }
  });
});
