import { describe, expect, it } from 'vitest';
import type { HostCommand } from './ipc.js';
import {
  ACTIVITY_SUMMARY_MAX_ITEMS,
  readActivitySummaryData,
  sanitizeActivityPermissionAction,
} from './activity-summary.js';

describe('activity/summary contracts', () => {
  it('accepts the command shape', () => {
    const command: HostCommand = { type: 'activity/summary', maxItems: 16 };
    expect(command.type).toBe('activity/summary');
  });

  it('keeps opaque ids and permission classifiers, dropping detail and paths', () => {
    const projected = readActivitySummaryData({
      items: [
        {
          sessionId: 'sess-1',
          runId: 'run-1',
          status: 'running',
          phase: 'tool-running',
          pendingPermission: true,
          permissionRequestId: 'perm-1',
          permissionAction: 'bash',
          detail: 'rm -rf /Users/private/secret',
          projectPath: '/Users/private/Projects/piwin',
          cwd: '/Users/private',
        },
      ],
      truncated: false,
      workingDirectory: '/Users/private',
    });
    expect(projected).toEqual({
      items: [
        {
          sessionId: 'sess-1',
          runId: 'run-1',
          status: 'running',
          phase: 'tool-running',
          pendingPermission: true,
          permissionRequestId: 'perm-1',
          permissionAction: 'bash',
        },
      ],
      truncated: false,
    });
    expect(JSON.stringify(projected)).not.toContain('/Users/private');
    expect(JSON.stringify(projected)).not.toContain('detail');
  });

  it('keeps permission-only rows and rejects empty session stubs', () => {
    const projected = readActivitySummaryData({
      items: [
        {
          sessionId: 'sess-perm',
          pendingPermission: true,
          permissionRequestId: 'perm-2',
          permissionAction: 'network:web_search',
        },
        { sessionId: 'sess-idle' },
      ],
      truncated: false,
    });
    expect(projected.items).toEqual([
      {
        sessionId: 'sess-perm',
        pendingPermission: true,
        permissionRequestId: 'perm-2',
        permissionAction: 'network:web_search',
      },
    ]);
  });

  it('sanitizes permission actions that look like paths', () => {
    expect(sanitizeActivityPermissionAction('file-write')).toBe('file-write');
    expect(sanitizeActivityPermissionAction('/Users/private/file')).toBeUndefined();
    expect(sanitizeActivityPermissionAction('rm -rf /tmp')).toBeUndefined();
  });

  it('caps items at the hard ceiling and marks truncated', () => {
    const items = Array.from({ length: ACTIVITY_SUMMARY_MAX_ITEMS + 3 }, (_, index) => ({
      sessionId: `sess-${index}`,
      runId: `run-${index}`,
      pendingPermission: false,
    }));
    const projected = readActivitySummaryData({ items, truncated: false });
    expect(projected.items).toHaveLength(ACTIVITY_SUMMARY_MAX_ITEMS);
    expect(projected.truncated).toBe(true);
  });
});
