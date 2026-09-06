import { describe, expect, it } from 'vitest';
import { inkLineNodeClass, resolveSessionNodeStatus, toolStatusToNodeStatus } from './session-node-status';

describe('resolveSessionNodeStatus', () => {
  const rest = {
    isWorking: false,
    hasActiveBackendService: false,
    isWaitingOnPermission: false,
    hasFailedAttention: false,
    hasCompletedAttention: false,
  };

  it('returns null when nothing is happening', () => {
    expect(resolveSessionNodeStatus(rest)).toBeNull();
  });

  it('resolves each flag to its own state in isolation', () => {
    expect(resolveSessionNodeStatus({ ...rest, isWorking: true })).toBe('running');
    expect(resolveSessionNodeStatus({ ...rest, hasActiveBackendService: true })).toBe(
      'background',
    );
    expect(resolveSessionNodeStatus({ ...rest, isWaitingOnPermission: true })).toBe(
      'waiting-you',
    );
    expect(resolveSessionNodeStatus({ ...rest, hasFailedAttention: true })).toBe('failed');
    expect(resolveSessionNodeStatus({ ...rest, hasCompletedAttention: true })).toBe('success');
  });

  it('prioritizes waiting-you over every other state', () => {
    expect(
      resolveSessionNodeStatus({
        isWorking: true,
        hasActiveBackendService: true,
        isWaitingOnPermission: true,
        hasFailedAttention: true,
        hasCompletedAttention: true,
      }),
    ).toBe('waiting-you');
  });

  it('prioritizes background service over plain working/failed/success', () => {
    expect(
      resolveSessionNodeStatus({
        isWorking: true,
        hasActiveBackendService: true,
        isWaitingOnPermission: false,
        hasFailedAttention: true,
        hasCompletedAttention: true,
      }),
    ).toBe('background');
  });

  it('prioritizes running over failed/success', () => {
    expect(
      resolveSessionNodeStatus({
        isWorking: true,
        hasActiveBackendService: false,
        isWaitingOnPermission: false,
        hasFailedAttention: true,
        hasCompletedAttention: true,
      }),
    ).toBe('running');
  });

  it('prioritizes failed over success', () => {
    expect(
      resolveSessionNodeStatus({
        isWorking: false,
        hasActiveBackendService: false,
        isWaitingOnPermission: false,
        hasFailedAttention: true,
        hasCompletedAttention: true,
      }),
    ).toBe('failed');
  });
});

describe('toolStatusToNodeStatus', () => {
  it('maps the existing 3-state tool status onto the shared vocabulary', () => {
    expect(toolStatusToNodeStatus('running')).toBe('running');
    expect(toolStatusToNodeStatus('done')).toBe('success');
    expect(toolStatusToNodeStatus('error')).toBe('failed');
  });
});

describe('inkLineNodeClass', () => {
  it('maps shared vocabulary onto proto-01 node classes', () => {
    expect(inkLineNodeClass('pending')).toBe('');
    expect(inkLineNodeClass('success')).toBe('done');
    expect(inkLineNodeClass('running')).toBe('run');
    expect(inkLineNodeClass('waiting-you')).toBe('wait');
    expect(inkLineNodeClass('background')).toBe('bg');
    expect(inkLineNodeClass('failed')).toBe('fail');
  });
});

