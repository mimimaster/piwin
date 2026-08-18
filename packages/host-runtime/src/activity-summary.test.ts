import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostRuntime } from './host-runtime.js';
import { projectActivitySummary } from './activity-summary.js';

describe('projectActivitySummary', () => {
  it('merges a live run with a pending permission and omits detail', () => {
    const projected = projectActivitySummary({
      runs: [
        {
          sessionId: 'sess-run',
          runId: 'run-1',
          status: 'running',
          phase: 'waiting-permission',
        },
      ],
      pendingPermissions: [
        {
          sessionId: 'sess-run',
          requestId: 'perm-1',
          action: 'bash',
        },
        {
          sessionId: 'sess-perm',
          requestId: 'perm-2',
          action: 'file-write',
        },
      ],
    });
    expect(projected).toEqual({
      items: [
        {
          sessionId: 'sess-perm',
          pendingPermission: true,
          permissionRequestId: 'perm-2',
          permissionAction: 'file-write',
        },
        {
          sessionId: 'sess-run',
          runId: 'run-1',
          status: 'running',
          phase: 'waiting-permission',
          pendingPermission: true,
          permissionRequestId: 'perm-1',
          permissionAction: 'bash',
        },
      ],
      truncated: false,
    });
  });

  it('drops path-like permission actions and caps the page', () => {
    const projected = projectActivitySummary({
      maxItems: 2,
      runs: [
        { sessionId: 'sess-a', runId: 'run-a', status: 'queued' },
        { sessionId: 'sess-b', runId: 'run-b', status: 'running' },
        { sessionId: 'sess-c', runId: 'run-c', status: 'cancelling' },
      ],
      pendingPermissions: [
        {
          sessionId: 'sess-a',
          requestId: 'perm-path',
          action: '/Users/private/secret',
        },
      ],
    });
    expect(projected.truncated).toBe(true);
    expect(projected.items).toHaveLength(2);
    expect(projected.items[0]).toMatchObject({
      sessionId: 'sess-a',
      pendingPermission: true,
      permissionRequestId: 'perm-path',
    });
    expect(projected.items[0]?.permissionAction).toBeUndefined();
    expect(JSON.stringify(projected)).not.toContain('/Users/private');
  });
});

describe('activity/summary command', () => {
  const runtimes: HostRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  it('lists a live foreground run and a pending permission without Host paths', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-activity-summary-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      testFixture: 'hang-until-abort',
    });
    runtimes.push(runtime);

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { scope: { kind: 'general' }, sessionName: 'activity' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const prompted = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hang' },
      foreground: { kind: 'if-idle' },
    });
    expect(prompted.success).toBe(true);
    if (!prompted.success) throw new Error(prompted.error);
    const runId = (prompted.data as { runId: string }).runId;

    const permissionPromise = runtime.requestPermission({
      sessionId,
      action: 'bash',
      detail: 'rm-recursive: rm -rf /Users/private/secret',
      defaultDecision: 'ask',
    });

    const summary = await runtime.handleCommand({ type: 'activity/summary' });
    expect(summary.success).toBe(true);
    if (!summary.success) throw new Error(summary.error);
    expect(JSON.stringify(summary.data)).not.toContain('/Users/private');
    expect(JSON.stringify(summary.data)).not.toContain('rm -rf');
    expect(summary.data).toEqual({
      items: [
        expect.objectContaining({
          sessionId,
          runId,
          pendingPermission: true,
          permissionAction: 'bash',
        }),
      ],
      truncated: false,
    });

    const listed = runtime.listPendingPermissionRequests();
    expect(listed).toHaveLength(1);
    const pending = listed[0];
    expect(pending).toMatchObject({ sessionId, action: 'bash' });
    if (pending === undefined) {
      throw new Error('expected a pending permission');
    }

    await runtime.handleCommand({
      type: 'permission/resolve',
      requestId: pending.requestId,
      decision: 'deny',
    });
    await permissionPromise;
  });
});
