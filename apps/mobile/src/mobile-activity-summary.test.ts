import { describe, expect, it } from 'vitest';
import type { HostPush, HostResponse } from '@piwin/contracts';
import {
  describeActivityItem,
  readActivitySummaryResponse,
  requestActivitySummary,
  resolveActivitySessionName,
  shouldRefreshActivitySummary,
} from './mobile-activity-summary.js';

describe('mobile activity summary', () => {
  it('reads a successful summary and treats command failure as empty, not the open chat', () => {
    const ok: HostResponse = {
      type: 'response',
      command: 'activity/summary',
      success: true,
      data: {
        items: [
          {
            sessionId: 'sess-other',
            runId: 'run-other',
            status: 'running',
            pendingPermission: false,
          },
        ],
        truncated: false,
      },
    };
    expect(readActivitySummaryResponse(ok).items).toEqual([
      {
        sessionId: 'sess-other',
        runId: 'run-other',
        status: 'running',
        pendingPermission: false,
      },
    ]);

    const denied: HostResponse = {
      type: 'response',
      command: 'activity/summary',
      success: false,
      error: 'Remote command is not enabled yet: activity/summary',
    };
    expect(readActivitySummaryResponse(denied)).toEqual({ items: [], truncated: false });
  });

  it('swallows transport failures as an empty Inbox instead of faking the open chat', async () => {
    await expect(
      requestActivitySummary({
        request: async () => {
          throw new Error('command-not-allowed');
        },
      }),
    ).resolves.toEqual({ items: [], truncated: false });
  });

  it('refreshes Inbox on run and permission pushes, not transcript deltas', () => {
    const runUpdated: HostPush = {
      type: 'run/updated',
      run: {
        runId: 'run-1',
        kind: 'session-turn',
        status: 'running',
        rootRunId: 'run-1',
        sessionId: 'sess-1',
      },
    };
    const terminal: HostPush = {
      type: 'run/terminal',
      run: {
        runId: 'run-1',
        kind: 'session-turn',
        status: 'completed',
        rootRunId: 'run-1',
        sessionId: 'sess-1',
      },
    };
    expect(shouldRefreshActivitySummary(runUpdated)).toBe(true);
    expect(shouldRefreshActivitySummary(terminal)).toBe(true);
    expect(
      shouldRefreshActivitySummary({
        type: 'permission/request',
        sessionId: 'sess-1',
        requestId: 'perm-1',
        action: 'bash',
        detail: 'ls',
        defaultDecision: 'ask',
      }),
    ).toBe(true);
    expect(
      shouldRefreshActivitySummary({
        type: 'host/status',
        mode: 'sdk',
        ready: true,
        mock: false,
      }),
    ).toBe(false);
  });

  it('joins session names and describes permission vs run rows', () => {
    const item = {
      sessionId: 'sess-1',
      runId: 'run-1',
      status: 'running' as const,
      pendingPermission: true,
      permissionAction: 'bash',
    };
    expect(
      resolveActivitySessionName(item, [{ sessionId: 'sess-1', name: '修复登录', scope: 'general' }]),
    ).toBe('修复登录');
    expect(describeActivityItem(item)).toBe('等待权限 · bash');
    expect(
      describeActivityItem({
        sessionId: 'sess-2',
        runId: 'run-2',
        status: 'queued',
        pendingPermission: false,
      }),
    ).toBe('排队中');
  });
});
