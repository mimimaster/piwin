import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SessionIndexRecord, SessionTranscriptMessage } from '@piwin/contracts';
import { loadSessionIndex, saveSessionIndex } from '@piwin/session';
import { repairLegacySessionNames } from './session-name-repair.js';

function sessionRecord(input: Partial<SessionIndexRecord> & { id: string }): SessionIndexRecord {
  return {
    projectPath: '/project',
    scope: { kind: 'project', projectPath: '/project' },
    createdAt: '2026-08-07T10:15:25.552Z',
    updatedAt: '2026-08-07T10:15:25.552Z',
    messageCount: 2,
    ...input,
  };
}

function userMessage(text: string): SessionTranscriptMessage {
  return {
    id: 'user-1',
    role: 'user',
    text,
    createdAt: '2026-08-07T10:16:01.354Z',
    status: 'done',
  };
}

describe('repairLegacySessionNames', () => {
  it('rebuilds a polluted text title from the first human-authored message body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-legacy-name-repair-'));
    const indexPath = join(root, 'index.json');
    const polluted = sessionRecord({
      id: 'session-msisgx7g-c6qhavyk',
      name: '[piwin-mode:agent] [piwin-… - 4',
      nameSource: 'text',
    });
    await saveSessionIndex(indexPath, { version: 2, sessions: [polluted] });
    const onRepaired = vi.fn();

    const records = await repairLegacySessionNames({
      indexPath,
      records: [polluted],
      loadTranscriptMessages: async () => [
        userMessage(
          [
            '[piwin-mode:agent]',
            '[piwin-prompt-meta kind="mode:agent" version="2"]',
            'Operating contract for this turn:',
            'Success: satisfy the goal.',
            '',
            '---',
            'User:',
            '排查下为什么 piwin 空窗口 Tool definitions 占那么多上下文',
          ].join('\n'),
        ),
      ],
      onRepaired,
    });

    expect(records[0]?.name).toBe('排查下为什么 piwin 空窗口 Tool…');
    expect(records[0]?.nameSource).toBe('text');
    expect(onRepaired).toHaveBeenCalledOnce();
    const persisted = await loadSessionIndex(indexPath);
    expect(persisted.sessions[0]?.name).toBe(records[0]?.name);
  });

  it('does not open transcripts or rewrite clean/user/llm titles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-legacy-name-guards-'));
    const indexPath = join(root, 'index.json');
    const records = [
      sessionRecord({ id: 'clean', name: 'Clean title', nameSource: 'text' }),
      sessionRecord({ id: 'user', name: '[piwin-mode:agent] custom', nameSource: 'user' }),
      sessionRecord({ id: 'llm', name: '[piwin-mode:agent] generated', nameSource: 'llm' }),
    ];
    await saveSessionIndex(indexPath, { version: 2, sessions: records });
    const loadTranscriptMessages = vi.fn(async () => []);

    const result = await repairLegacySessionNames({
      indexPath,
      records,
      loadTranscriptMessages,
    });

    expect(loadTranscriptMessages).not.toHaveBeenCalled();
    expect(result.map((record) => record.name)).toEqual(records.map((record) => record.name));
  });
});
