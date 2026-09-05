import { describe, expect, it } from 'vitest';
import {
  collectPendingPermissionSessionIds,
  collectRunningSessionIds,
  formatClock,
  mapActivityRows,
  mapPermissionGate,
  mapSessionGroups,
  mapTranscriptRows,
  pickContinueSession,
  relativeTime,
  type InkstoneChatRow,
} from './host-bridge.js';
import type {
  ActivitySummaryItem,
  RemoteProjectSummary,
  RemoteSessionSummary,
} from '@piwin/contracts';
import type { RemotePermissionRequest } from '../../mobile-transcript.js';

const NOW = new Date('2026-09-05T10:00:00+08:00').getTime();

function iso(minutesAgo: number): string {
  return new Date(NOW - minutesAgo * 60000).toISOString();
}

describe('inkstone host bridge', () => {
  it('formats relative labels like the prototype list', () => {
    expect(relativeTime(iso(0), NOW)).toBe('刚刚');
    expect(relativeTime(iso(12), NOW)).toBe('12 分钟');
    expect(relativeTime(iso(60 * 3), NOW)).toBe('3 小时');
    expect(relativeTime(iso(60 * 30), NOW)).toBe('昨天');
    expect(relativeTime(undefined, NOW)).toBe('');
  });

  it('formats message clocks as HH:MM', () => {
    expect(formatClock('2026-09-05T09:32:00+08:00')).toBe('09:32');
    expect(formatClock(undefined)).toBe('');
  });

  it('groups sessions by project with status dots and pinned first', () => {
    const groups = mapSessionGroups({
      sessions: [
        {
          sessionId: 's1',
          name: ' 让会话拥有记忆 ',
          scope: 'project',
          projectId: 'p1',
          updatedAt: iso(2),
          lastPreview: '正在补全恢复逻辑',
        },
        {
          sessionId: 's2',
          name: '归档的会话',
          scope: 'project',
          projectId: 'p1',
          archived: true,
          updatedAt: iso(3),
        },
        {
          sessionId: 's3',
          name: '修复移动端重连',
          scope: 'project',
          projectId: 'p1',
          updatedAt: iso(26),
          pinned: true,
        },
        { sessionId: 's4', scope: 'general', updatedAt: iso(60 * 25), messageCount: 4 },
      ] as RemoteSessionSummary[],
      projects: [{ projectId: 'p1', displayName: 'piwin' }] as RemoteProjectSummary[],
      runningSessionIds: new Set(['s1']),
      pendingPermissionSessionIds: new Set(['s3']),
      now: NOW,
    });
    expect(groups.length).toBe(2);
    const piwin = groups[0];
    if (piwin === undefined) {
      throw new Error('expected piwin group');
    }
    expect(piwin.project).toBe('piwin');
    expect(piwin.rows.map((row) => row.sessionId)).toEqual(['s3', 's1']);
    expect(piwin.rows[0]).toMatchObject({
      status: 'waiting',
      subtitle: '等你批准 1 项操作',
      time: '26 分钟',
    });
    expect(piwin.rows[1]).toMatchObject({
      status: 'running',
      subtitle: '正在工作',
      time: '2 分钟',
    });
    const general = groups[1];
    if (general === undefined) {
      throw new Error('expected general group');
    }
    expect(general.project).toBe('一般会话');
    expect(general.rows[0]).toMatchObject({ status: 'done', subtitle: '4 条消息', time: '昨天' });
  });

  it('picks the running session for the continue card, else the most recent', () => {
    const sessions = [
      { sessionId: 'a', scope: 'general', updatedAt: iso(5) },
      { sessionId: 'b', scope: 'general', updatedAt: iso(1) },
    ] as RemoteSessionSummary[];
    expect(pickContinueSession(sessions, new Set(['b']))?.sessionId).toBe('b');
    expect(pickContinueSession(sessions, new Set())?.sessionId).toBe('a');
    expect(pickContinueSession([], new Set())).toBeUndefined();
  });

  it('projects transcript messages onto chat rows with tool folds', () => {
    const rows: InkstoneChatRow[] = mapTranscriptRows([
      {
        id: 'm1',
        role: 'user',
        text: '让会话拥有记忆。',
        createdAt: '2026-09-05T09:32:00+08:00',
        status: 'done',
      },
      {
        id: 'm2',
        role: 'assistant',
        text: '记忆应该安静地发生。',
        createdAt: '2026-09-05T09:34:00+08:00',
        status: 'streaming',
        toolCalls: [
          {
            id: 't1',
            name: 'read',
            status: 'done',
            actionVerb: '读取',
            summary: 'session-index.ts',
            durationMs: 200,
          },
          {
            id: 't2',
            name: 'grep',
            status: 'running',
            actionVerb: '检索',
            summary: 'restoreSession',
          },
        ],
      },
      { id: 'm3', role: 'system', text: 'internal', createdAt: iso(1), status: 'done' },
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['user', 'tools', 'assistant']);
    const user = rows[0];
    if (user === undefined || user.kind !== 'user') {
      throw new Error('expected user row');
    }
    expect(user.time).toBe('09:32');
    expect(rows[1]).toMatchObject({ kind: 'tools', label: '正在调用工具' });
    const tools = rows[1];
    if (tools === undefined || tools.kind !== 'tools') {
      throw new Error('expected tools row');
    }
    expect(tools.steps[0]?.meta).toBe('0.2s');
    expect(tools.steps[1]?.status).toBe('running');
    expect(rows[2]).toMatchObject({ kind: 'assistant', streaming: true });
  });

  it('maps permission requests into the gate view', () => {
    const request = {
      type: 'permission/request',
      sessionId: 's1',
      requestId: 'r1',
      action: 'bash',
      detail: '执行测试命令',
      defaultDecision: 'ask',
      context: {
        kind: 'command',
        summary: '运行测试',
        command: 'pnpm test',
        cwd: '~/Developer/piwin',
        destructive: false,
      },
    } as unknown as RemotePermissionRequest;
    const gate = mapPermissionGate(request);
    expect(gate).toMatchObject({
      requestId: 'r1',
      title: '运行测试',
      command: 'pnpm test',
      cwd: '~/Developer/piwin',
      destructive: false,
    });
    expect(mapPermissionGate(undefined)).toBeUndefined();
  });

  it('splits activity items into pending and running rows', () => {
    const { pending, running } = mapActivityRows({
      items: [
        { sessionId: 's3', pendingPermission: true, status: 'running' },
        { sessionId: 's1', pendingPermission: false, status: 'running' },
      ] as ActivitySummaryItem[],
      sessions: [
        { sessionId: 's3', name: '修复移动端重连', scope: 'project' },
        { sessionId: 's1', name: ' 让会话拥有记忆 ', scope: 'project' },
      ] as RemoteSessionSummary[],
      projects: [],
    });
    expect(pending[0]).toMatchObject({
      sessionId: 's3',
      title: '修复移动端重连',
      status: 'waiting',
    });
    expect(running[0]).toMatchObject({
      sessionId: 's1',
      title: '让会话拥有记忆',
      status: 'running',
    });
  });

  it('collects run and permission session id sets', () => {
    const items = [
      { sessionId: 's1', pendingPermission: false, status: 'running' },
      { sessionId: 's3', pendingPermission: true, status: 'running' },
    ] as ActivitySummaryItem[];
    expect(collectRunningSessionIds(items)).toEqual(new Set(['s1']));
    expect(collectPendingPermissionSessionIds(items)).toEqual(new Set(['s3']));
  });
});
