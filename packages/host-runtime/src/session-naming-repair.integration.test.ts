import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  HostPush,
  SessionIndexRecord,
  SessionResumeData,
  SessionTranscriptDocument,
} from '@piwin/contracts';
import {
  loadSessionIndex,
  saveSessionIndex,
  saveSessionTranscript,
} from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { getPiwinSessionIndexPath, getPiwinSessionTranscriptPath } from './paths.js';

const PROJECT_PATH = '/Volumes/BigDisk/Projects/pitest';

function pollutedRecord(id: string): SessionIndexRecord {
  return {
    id,
    projectPath: PROJECT_PATH,
    scope: { kind: 'project', projectPath: PROJECT_PATH },
    workingDirectory: PROJECT_PATH,
    createdAt: '2026-08-07T10:15:25.552Z',
    updatedAt: '2026-08-07T10:21:44.920Z',
    messageCount: 2,
    name: '[piwin-mode:agent] [piwin-… - 4',
    nameSource: 'text',
  };
}

function transcript(id: string): SessionTranscriptDocument {
  return {
    version: 1,
    sessionId: id,
    projectPath: PROJECT_PATH,
    updatedAt: '2026-08-07T10:21:44.920Z',
    messages: [
      {
        id: 'user-1',
        role: 'user',
        text: [
          '[piwin-mode:agent]',
          '[piwin-prompt-meta kind="mode:agent" version="2"]',
          'Operating contract for this turn:',
          'Success: satisfy the goal.',
          '',
          '---',
          'User:',
          '排查下为什么 piwin 空窗口 Tool definitions 占那么多上下文',
        ].join('\n'),
        createdAt: '2026-08-07T10:16:01.354Z',
        status: 'done',
      },
    ],
  };
}

async function seedPollutedSession(root: string, sessionId: string): Promise<void> {
  await saveSessionIndex(getPiwinSessionIndexPath(root), {
    version: 2,
    sessions: [pollutedRecord(sessionId)],
  });
  await saveSessionTranscript(getPiwinSessionTranscriptPath(root, sessionId), transcript(sessionId));
}

describe('HostRuntime legacy session name repair', () => {
  it('repairs and publishes a polluted title during session/list hydration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-list-name-repair-'));
    const sessionId = 'session-msisgx7g-c6qhavyk';
    await seedPollutedSession(root, sessionId);
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: root,
      onPush: (message) => pushes.push(message),
    });

    try {
      const response = await runtime.handleCommand({
        type: 'session/list',
        scope: { kind: 'project', projectPath: PROJECT_PATH },
      });
      expect(response.success).toBe(true);
      if (!response.success) throw new Error(response.error);
      const sessions = (response.data as { sessions: Array<{ id: string; name?: string }> })
        .sessions;
      expect(sessions.find((session) => session.id === sessionId)?.name).toBe(
        '排查下为什么 piwin 空窗口 Tool…',
      );
      expect(pushes).toContainEqual({
        type: 'session/name-updated',
        sessionId,
        name: '排查下为什么 piwin 空窗口 Tool…',
        nameSource: 'text',
      });
      const persisted = await loadSessionIndex(getPiwinSessionIndexPath(root));
      expect(persisted.sessions[0]?.updatedAt).toBe('2026-08-07T10:21:44.920Z');
    } finally {
      await runtime.dispose();
    }
  });

  it('also repairs the title on direct resume without a preceding list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-resume-name-repair-'));
    const sessionId = 'session-legacy-direct-resume';
    await seedPollutedSession(root, sessionId);
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: root });

    try {
      const response = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(response.success).toBe(true);
      if (!response.success) throw new Error(response.error);
      expect((response.data as SessionResumeData).name).toBe(
        '排查下为什么 piwin 空窗口 Tool…',
      );
    } finally {
      await runtime.dispose();
    }
  });
});
