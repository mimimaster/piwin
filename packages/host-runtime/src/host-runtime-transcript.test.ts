import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openSessionTranscriptStore, type SessionTranscriptStore } from '@piwin/session';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { ensureTranscriptRecorder, recordUserPrompt } from './host-runtime-transcript.js';
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

  it('does not downgrade a candidate recorder while the old generation is still published', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-runtime-prompt-replacement-'));
    const sessionId = 'session-prompt-during-replacement';
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId,
      projectPath: '/project',
    });
    const transcriptRecorders = new Map<string, TranscriptRecorder>();
    const deps = {
      transcriptRecorders,
      transcriptStores: { get: vi.fn(async () => store) },
      sessionModels: new Map(),
      sessionProjects: new Map([[sessionId, '/project']]),
      runtimeController: {
        // Candidate binding installs the new recorder before publishCandidate
        // advances this active-generation projection.
        getStatus: () => ({ generationId: 'generation-old' }),
      },
      withTranscriptStore: async <Result>(
        _candidateSessionId: string,
        operation: (transcriptStore: SessionTranscriptStore) => Promise<Result>,
      ): Promise<Result> => operation(store),
      healthTurnBySession: new Map(),
      push: vi.fn(),
      maybeAssignTextNameFromPrompt: vi.fn(async () => undefined),
    } as unknown as HostRuntimeKernel;
    deps.ensureTranscriptRecorder = (candidateSessionId, projectPath, runtimeGenerationId) =>
      ensureTranscriptRecorder(deps, candidateSessionId, projectPath, runtimeGenerationId);

    try {
      await ensureTranscriptRecorder(deps, sessionId, '/project', 'generation-old');
      await ensureTranscriptRecorder(deps, sessionId, '/project', 'generation-new');
      const candidateRecorder = transcriptRecorders.get(sessionId);
      if (candidateRecorder === undefined) throw new Error('candidate recorder was not created');

      await recordUserPrompt(deps, sessionId, {
        text: 'prompt during replacement',
        clientMessageId: 'user-during-replacement',
        skillId: 'writing-plans',
        contextRefs: [{ kind: 'selection', snapshotText: 'quoted', label: 'quoted' }],
      });

      expect(transcriptRecorders.get(sessionId)).toBe(candidateRecorder);
      expect(candidateRecorder.runtimeGenerationId).toBe('generation-new');
      expect(await store.getMessage('user-during-replacement')).toMatchObject({
        role: 'user',
        text: 'prompt during replacement',
        skillId: 'writing-plans',
        contextRefs: [{ kind: 'selection', snapshotText: 'quoted', label: 'quoted' }],
      });
    } finally {
      for (const recorder of transcriptRecorders.values()) recorder.dispose();
      store.close();
    }
  });
});
