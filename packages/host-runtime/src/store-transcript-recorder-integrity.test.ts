import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSessionTranscriptStore } from '@piwin/session';
import { createStoreTranscriptRecorder } from './store-transcript-recorder.js';

describe('createStoreTranscriptRecorder integrity', () => {
  it('persists explicit skillId on the user transcript row', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-skill-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-skill',
      projectPath: '/project',
    });
    await store.markAuthoritative();
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-1',
    });

    try {
      await recorder.recordUserPrompt({
        text: '/vanta who are you',
        clientMessageId: 'user-skill',
        skillId: 'vanta',
      });
      const stored = await store.getMessage('user-skill');
      expect(stored?.skillId).toBe('vanta');
      expect(stored?.text).toBe('/vanta who are you');
    } finally {
      recorder.dispose();
      store.close();
    }
  });

  it('does not paint a new run error onto the previous assistant', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-store-recorder-cross-run-error-'));
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: 'session-cross-run-error',
      projectPath: '/project',
    });
    const recorder = createStoreTranscriptRecorder({
      store,
      runtimeGenerationId: 'generation-cross-run-error',
    });

    try {
      await recorder.recordEvent({
        type: 'message/start',
        messageId: 'assistant-old',
        role: 'assistant',
        runId: 'run-old',
      });
      await recorder.recordEvent({
        type: 'message/text_delta',
        messageId: 'assistant-old',
        delta: 'previous turn finished',
        runId: 'run-old',
      });
      await recorder.recordEvent({
        type: 'message/end',
        messageId: 'assistant-old',
        runId: 'run-old',
      });
      await recorder.recordEvent({
        type: 'error',
        message: 'Unexpected non-whitespace character after JSON',
        runId: 'run-new',
      });
      await recorder.flush();

      expect(await store.getMessage('assistant-old')).toMatchObject({
        text: 'previous turn finished',
        status: 'done',
        runId: 'run-old',
      });
      expect((await store.getMessage('assistant-old'))?.failure).toBeUndefined();
      const messages = await store.listTail(10);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            runId: 'run-new',
            failure: expect.objectContaining({
              message: 'Unexpected non-whitespace character after JSON',
            }),
          }),
        ]),
      );
    } finally {
      recorder.dispose();
      store.close();
    }
  });
});
