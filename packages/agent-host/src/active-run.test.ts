import { describe, expect, it } from 'vitest';
import {
  buildRunPhaseEvent,
  buildRunTerminalEvent,
  createActiveRunRegistry,
} from './active-run.js';
import { createUserStopAbortReason } from './run-abort-reason.js';

describe('createActiveRunRegistry', () => {
  it('registers a run and rejects a second foreground run', () => {
    const registry = createActiveRunRegistry();
    const first = registry.register('session-1');
    expect(first.runId).toBeTruthy();
    expect(registry.get('session-1')?.runId).toBe(first.runId);

    expect(() => registry.register('session-1')).toThrow(/run-active/);
  });

  it('requestCancel aborts the controller and sets cancelling phase', () => {
    const registry = createActiveRunRegistry();
    const run = registry.register('session-1');
    expect(run.abortController.signal.aborted).toBe(false);

    const cancelled = registry.requestCancel('session-1');
    expect(cancelled?.runId).toBe(run.runId);
    expect(run.abortController.signal.aborted).toBe(true);
    expect(run.phase).toBe('cancelling');
    expect(run.abortController.signal.reason).toEqual(createUserStopAbortReason());
  });

  it('requestCancel attaches a custom abort reason for tools', () => {
    const registry = createActiveRunRegistry();
    const run = registry.register('session-1');
    const reason = createUserStopAbortReason();
    registry.requestCancel('session-1', run.runId, reason);
    expect(run.abortController.signal.reason).toEqual(reason);
  });

  it('requestCancel with mismatched runId is a no-op', () => {
    const registry = createActiveRunRegistry();
    const run = registry.register('session-1');
    const result = registry.requestCancel('session-1', 'other-run-id');
    expect(result).toBeUndefined();
    expect(run.abortController.signal.aborted).toBe(false);
  });

  it('markTerminal is idempotent', () => {
    const registry = createActiveRunRegistry();
    const run = registry.register('session-1');
    expect(registry.markTerminal('session-1', run.runId)).toBe(true);
    expect(registry.markTerminal('session-1', run.runId)).toBe(false);
  });

  it('noteAgentEvent transitions phase on first token and tools', () => {
    const registry = createActiveRunRegistry();
    registry.register('session-1');

    expect(
      registry.noteAgentEvent('session-1', {
        type: 'message/text_delta',
        messageId: 'm1',
        delta: 'hi',
      }),
    ).toBe('streaming');

    expect(
      registry.noteAgentEvent('session-1', {
        type: 'tool/start',
        toolCallId: 't1',
        toolName: 'bash',
      }),
    ).toBe('tool-running');

    expect(
      registry.noteAgentEvent('session-1', {
        type: 'tool/end',
        toolCallId: 't1',
        isError: false,
      }),
    ).toBe('streaming');
  });

  it('builds run phase and terminal events', () => {
    const phase = buildRunPhaseEvent('s1', 'r1', 'accepted');
    expect(phase.type).toBe('run/phase');
    if (phase.type === 'run/phase') {
      expect(phase.phase).toBe('accepted');
    }

    const terminal = buildRunTerminalEvent('s1', 'r1', 'cancelled', 'cancelled');
    expect(terminal.type).toBe('run/terminal');
    if (terminal.type === 'run/terminal') {
      expect(terminal.outcome).toBe('cancelled');
      expect(terminal.code).toBe('cancelled');
    }
  });
});
