import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDuplicateSessionName,
  cloneTranscriptForDuplicate,
  duplicateProductSession,
} from './duplicate-session.js';
import { createSessionRecord, getSessionRecord, upsertSessionRecord } from './session-index-store.js';
import { saveSessionTranscript } from './message-store.js';

describe('duplicate-session', () => {
  it('builds copy names without empty base', () => {
    expect(buildDuplicateSessionName('Alpha', 's1')).toBe('Copy of Alpha');
    expect(buildDuplicateSessionName('Copy of Alpha', 's1')).toBe('Copy of Alpha (2)');
  });

  it('clones transcript with new message ids and settles streaming', () => {
    const cloned = cloneTranscriptForDuplicate(
      {
        version: 1,
        sessionId: 'src',
        projectPath: '/tmp/proj',
        updatedAt: '2026-07-21T00:00:00.000Z',
        messages: [
          {
            id: 'm1',
            role: 'user',
            text: 'hello',
            createdAt: '2026-07-21T00:00:00.000Z',
            status: 'done',
          },
          {
            id: 'm2',
            role: 'assistant',
            text: 'partial',
            createdAt: '2026-07-21T00:00:01.000Z',
            status: 'streaming',
          },
        ],
      },
      'new-id',
    );
    expect(cloned.sessionId).toBe('new-id');
    expect(cloned.messages).toHaveLength(2);
    expect(cloned.messages[0]?.id).not.toBe('m1');
    expect(cloned.messages[1]?.status).toBe('done');
    expect(cloned.messages[0]?.text).toBe('hello');
  });

  it('duplicates index + transcript on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-dup-'));
    const indexPath = join(dir, 'index.json');
    const sourceId = 'source-1';
    const targetId = 'target-1';
    const sourceTranscriptPath = join(dir, sourceId, 'transcript.json');
    const targetTranscriptPath = join(dir, targetId, 'transcript.json');

    await upsertSessionRecord(
      indexPath,
      createSessionRecord({
        id: sourceId,
        projectPath: '/tmp/proj',
        name: 'Original',
      }),
    );
    await saveSessionTranscript(sourceTranscriptPath, {
      version: 1,
      sessionId: sourceId,
      projectPath: '/tmp/proj',
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'fork me',
          createdAt: new Date().toISOString(),
          status: 'done',
        },
      ],
    });

    const result = await duplicateProductSession(
      {
        indexPath,
        sourceTranscriptPath,
        targetTranscriptPath,
      },
      { sourceSessionId: sourceId, newSessionId: targetId },
    );
    expect(result).toBeTruthy();
    expect(result?.record.id).toBe(targetId);
    expect(result?.record.name).toBe('Copy of Original');
    expect(result?.record.messageCount).toBe(1);
    expect(result?.transcript.messages[0]?.text).toBe('fork me');

    const indexed = await getSessionRecord(indexPath, targetId);
    expect(indexed?.name).toBe('Copy of Original');
    expect(indexed?.isPinned).toBe(false);
  });
});
