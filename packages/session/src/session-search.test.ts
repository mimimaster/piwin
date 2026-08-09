import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendTranscriptMessage, createUserTranscriptMessage } from './message-store.js';
import { createSessionRecord, upsertSessionRecord } from './session-index-store.js';
import { searchSessions } from './session-search.js';

describe('searchSessions', () => {
  it('hits lastPreview and transcript body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-search-'));
    const indexPath = join(dir, 'index.json');
    const transcriptPath = join(dir, 's1', 'transcript.json');

    const record = createSessionRecord({
      id: 's1',
      projectPath: '/tmp/proj',
      name: 'alpha chat',
    });
    record.lastPreview = 'discussing widgets';
    await upsertSessionRecord(indexPath, record);
    await appendTranscriptMessage(
      transcriptPath,
      's1',
      '/tmp/proj',
      createUserTranscriptMessage({ id: 'u1', text: 'please refactor the widget loader' }),
    );

    const byPreview = await searchSessions(
      { indexPath },
      { query: 'widgets', projectPath: '/tmp/proj' },
    );
    expect(byPreview.hits.some((hit) => hit.sessionId === 's1')).toBe(true);

    const byBody = await searchSessions(
      {
        indexPath,
        resolveTranscriptPath: () => transcriptPath,
      },
      { query: 'refactor', projectPath: '/tmp/proj' },
    );
    expect(byBody.hits[0]?.sessionId).toBe('s1');
    expect(byBody.hits[0]?.messageId).toBe('u1');
    expect(byBody.hits[0]?.snippet?.toLowerCase()).toContain('refactor');
  });

  it('applies lifecycle filtering before the bounded search result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-search-lifecycle-'));
    const indexPath = join(dir, 'index.json');
    const active = createSessionRecord({
      id: 'active',
      projectPath: '',
      scope: { kind: 'general' },
      name: 'active chat',
    });
    const archived = createSessionRecord({
      id: 'archived',
      projectPath: '',
      scope: { kind: 'general' },
      name: 'archived chat',
    });
    archived.isArchived = true;
    archived.archivedAt = '2026-08-09T00:00:00.000Z';
    await upsertSessionRecord(indexPath, active);
    await upsertSessionRecord(indexPath, archived);

    const activeResult = await searchSessions(
      { indexPath },
      { query: 'chat', scope: { kind: 'general' }, lifecycle: 'active', limit: 10 },
    );
    const archivedResult = await searchSessions(
      { indexPath },
      { query: 'chat', scope: { kind: 'general' }, lifecycle: 'archived', limit: 10 },
    );

    expect(activeResult.hits.map((hit) => hit.sessionId)).toEqual(['active']);
    expect(archivedResult.hits.map((hit) => hit.sessionId)).toEqual(['archived']);
  });
});
