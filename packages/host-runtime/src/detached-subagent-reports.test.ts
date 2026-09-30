import { describe, expect, it, vi } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import {
  DETACHED_REPORT_CONTINUATION_PROMPT,
  DetachedSubagentRegistry,
  PIWIN_TESTER_REPORT_MARKER,
  deliverDetachedReport,
  formatDetachedReport,
} from './detached-subagent-reports.js';

describe('DetachedSubagentRegistry', () => {
  it('replaces the previous run and reports it for cancellation', () => {
    const registry = new DetachedSubagentRegistry();
    expect(registry.replace('s1', { runId: 'run-a' })).toBeUndefined();
    expect(registry.replace('s1', { runId: 'run-b', schemeId: 'auto' })).toBe('run-a');
    expect(registry.running('s1')).toBe('run-b');
    expect(registry.isDetached('s1', 'run-b')).toBe(true);
    expect(registry.isDetached('s1', 'run-a')).toBe(false);
  });

  it('settles only the current run, so a replaced run stays silent', () => {
    const registry = new DetachedSubagentRegistry();
    registry.replace('s1', { runId: 'run-a' });
    registry.replace('s1', { runId: 'run-b', schemeId: 'auto' });
    expect(registry.settle('s1', 'run-a')).toBeUndefined();
    expect(registry.settle('s1', 'run-b')).toEqual({ runId: 'run-b', schemeId: 'auto' });
    expect(registry.running('s1')).toBeUndefined();
  });

  it('drains reports once, marked, and drops them with the session', () => {
    const registry = new DetachedSubagentRegistry();
    registry.addReport('s1', 'first');
    registry.addReport('s1', 'second');
    expect(registry.hasReports('s1')).toBe(true);
    const block = registry.takeReports('s1');
    expect(block?.startsWith(PIWIN_TESTER_REPORT_MARKER)).toBe(true);
    expect(block).toContain('first');
    expect(block).toContain('second');
    expect(registry.takeReports('s1')).toBeUndefined();
    registry.addReport('s2', 'x');
    registry.disposeSession('s2');
    expect(registry.hasReports('s2')).toBe(false);
  });
});

describe('formatDetachedReport', () => {
  it('prefers the contract message and falls back to a blocked note', () => {
    expect(
      formatDetachedReport({ runId: 'r1', executionStatus: 'completed', summaryPreview: 'pass\n- ok' }),
    ).toContain('pass\n- ok');
    expect(formatDetachedReport({ runId: 'r2', executionStatus: 'failed', error: 'boom' })).toContain(
      'blocked\n- boom',
    );
    expect(formatDetachedReport({ runId: 'r3', executionStatus: 'cancelled' })).toContain(
      'no report (cancelled)',
    );
  });
});

describe('deliverDetachedReport', () => {
  function setup(options: { foreground?: Array<string | undefined>; admit?: () => Promise<{ success: boolean; error?: string }> }) {
    const registry = new DetachedSubagentRegistry();
    registry.addReport('s1', 'tester run r1 (completed):\npass');
    const pushes: HostPush[] = [];
    const foreground = [...(options.foreground ?? [undefined])];
    const joinRun = vi.fn(async () => undefined);
    const admitContinuation = vi.fn(options.admit ?? (async () => ({ success: true })));
    const deps = {
      registry,
      getForegroundRunId: () => foreground.shift() ?? undefined,
      joinRun,
      admitContinuation,
      push: (message: HostPush) => pushes.push(message),
    };
    return { registry, pushes, joinRun, admitContinuation, deps };
  }

  it('starts a continuation turn when the session is idle and the report is unread', async () => {
    const { deps, admitContinuation } = setup({});
    await deliverDetachedReport(deps, 's1', 'auto');
    expect(admitContinuation).toHaveBeenCalledWith('s1', 'auto');
  });

  it('waits for a running turn and does nothing if that turn already consumed the report', async () => {
    const { deps, registry, joinRun, admitContinuation } = setup({ foreground: ['run-9', undefined] });
    joinRun.mockImplementation(async () => {
      registry.takeReports('s1');
    });
    await deliverDetachedReport(deps, 's1', 'auto');
    expect(joinRun).toHaveBeenCalledWith('run-9');
    expect(admitContinuation).not.toHaveBeenCalled();
  });

  it('keeps the report queued and logs when admission is rejected', async () => {
    const { deps, registry, pushes } = setup({
      admit: async () => ({ success: false, error: 'model-unavailable' }),
    });
    await deliverDetachedReport(deps, 's1', undefined);
    expect(registry.hasReports('s1')).toBe(true);
    expect(pushes[0]).toMatchObject({ type: 'host/log', level: 'warn' });
  });

  it('retries after a run-active race instead of dropping the report', async () => {
    let calls = 0;
    const { deps, admitContinuation } = setup({
      admit: async () => (++calls === 1 ? { success: false, error: 'run-active: busy' } : { success: true }),
    });
    await deliverDetachedReport(deps, 's1', 'auto');
    expect(admitContinuation).toHaveBeenCalledTimes(2);
  });

  it('uses a continuation prompt that folds the report into the answer', () => {
    expect(DETACHED_REPORT_CONTINUATION_PROMPT).toMatch(/pass \| fail \| blocked/);
  });
});
