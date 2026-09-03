import { describe, expect, it } from 'vitest';
import { mapToolExecutionEndEvent } from './tool-event-map.js';
import { buildToolPresentation } from './tool-presentation.js';

describe('goal tool presentation', () => {
  it('attaches a completed signal with evidence and artifacts', () => {
    const presentation = buildToolPresentation({
      toolName: 'goal_complete',
      outputText: '🎯 Goal Complete: Auth tests pass',
      details: {
        status: 'completed',
        summary: 'Auth tests pass',
        verification: 'pnpm test -- auth (5/5)',
        artifacts: ['packages/auth/src/index.ts'],
      },
    });
    expect(presentation.goal).toEqual({
      phase: 'completed',
      summary: 'Auth tests pass',
      verification: 'pnpm test -- auth (5/5)',
      artifacts: ['packages/auth/src/index.ts'],
    });
  });

  it('attaches a blocked signal with its unblock action', () => {
    const presentation = buildToolPresentation({
      toolName: 'goal_blocked',
      details: {
        status: 'blocked',
        reason: 'Two auth strategies are viable',
        unblockAction: 'Choose JWT or session cookies',
      },
    });
    expect(presentation.goal).toEqual({
      phase: 'blocked',
      reason: 'Two auth strategies are viable',
      unblockAction: 'Choose JWT or session cookies',
    });
  });

  it('attaches a waited signal', () => {
    const presentation = buildToolPresentation({
      toolName: 'goal_wait',
      details: { status: 'waited', reason: 'CI queue', durationSeconds: 30 },
    });
    expect(presentation.goal).toEqual({
      phase: 'waited',
      reason: 'CI queue',
      durationSeconds: 30,
    });
  });

  it('leaves non-goal tools alone even when details carry a status', () => {
    const presentation = buildToolPresentation({
      toolName: 'write_file',
      details: { status: 'completed', summary: 'wrote a file' },
    });
    expect(presentation.goal).toBeUndefined();
  });

  it('omits the signal when a goal tool reports an unusable payload', () => {
    const presentation = buildToolPresentation({
      toolName: 'goal_complete',
      details: { status: 'completed' },
    });
    expect(presentation.goal).toBeUndefined();
  });

  it('carries the signal through tool/end event mapping', () => {
    const [event] = mapToolExecutionEndEvent({
      toolCallId: 'call-1',
      toolName: 'goal_blocked',
      result: {
        content: [{ type: 'text', text: '⚠️ Goal Blocked: needs a decision' }],
        details: { status: 'blocked', reason: 'needs a decision' },
      },
    });
    expect(event?.type).toBe('tool/end');
    if (event?.type !== 'tool/end') throw new Error('expected a tool/end event');
    expect(event.presentation?.goal).toEqual({ phase: 'blocked', reason: 'needs a decision' });
  });

  it('reads details from the event root when there is no nested result', () => {
    const [event] = mapToolExecutionEndEvent({
      toolCallId: 'call-2',
      toolName: 'goal_wait',
      output: 'Waited: server spin-up',
      details: { status: 'waited', reason: 'server spin-up', durationSeconds: 5 },
    });
    if (event?.type !== 'tool/end') throw new Error('expected a tool/end event');
    expect(event.presentation?.goal).toEqual({
      phase: 'waited',
      reason: 'server spin-up',
      durationSeconds: 5,
    });
  });
});