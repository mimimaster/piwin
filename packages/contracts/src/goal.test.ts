import { describe, expect, it } from 'vitest';
import { isGoalToolName, parseGoalDisplayPayload } from './goal.js';

describe('isGoalToolName', () => {
  it('accepts the three bundled goal tools', () => {
    expect(isGoalToolName('goal_complete')).toBe(true);
    expect(isGoalToolName('goal_blocked')).toBe(true);
    expect(isGoalToolName('goal_wait')).toBe(true);
  });

  it('rejects lookalikes and non-strings', () => {
    expect(isGoalToolName('goal')).toBe(false);
    expect(isGoalToolName('goal_completed')).toBe(false);
    expect(isGoalToolName(undefined)).toBe(false);
    expect(isGoalToolName(42)).toBe(false);
  });
});

describe('parseGoalDisplayPayload', () => {
  it('parses a completed signal with evidence and artifacts', () => {
    expect(
      parseGoalDisplayPayload({
        status: 'completed',
        summary: 'Auth tests pass',
        verification: 'pnpm test -- auth (5/5)',
        artifacts: ['packages/auth/src/index.ts', 'packages/auth/src/token.ts'],
      }),
    ).toEqual({
      phase: 'completed',
      summary: 'Auth tests pass',
      verification: 'pnpm test -- auth (5/5)',
      artifacts: ['packages/auth/src/index.ts', 'packages/auth/src/token.ts'],
    });
  });

  it('keeps a completed signal that carries only a summary', () => {
    expect(parseGoalDisplayPayload({ status: 'completed', summary: 'Done' })).toEqual({
      phase: 'completed',
      summary: 'Done',
    });
  });

  it('parses a blocked signal with an unblock action', () => {
    expect(
      parseGoalDisplayPayload({
        status: 'blocked',
        reason: 'Two auth strategies are viable',
        unblockAction: 'Choose JWT or session cookies',
      }),
    ).toEqual({
      phase: 'blocked',
      reason: 'Two auth strategies are viable',
      unblockAction: 'Choose JWT or session cookies',
    });
  });

  it('parses a waited signal and keeps a zero duration out of the payload', () => {
    expect(
      parseGoalDisplayPayload({ status: 'waited', reason: 'CI queue', durationSeconds: 30 }),
    ).toEqual({ phase: 'waited', reason: 'CI queue', durationSeconds: 30 });
    expect(parseGoalDisplayPayload({ status: 'waited', reason: 'CI queue' })).toEqual({
      phase: 'waited',
      reason: 'CI queue',
    });
  });

  it('accepts a JSON-encoded payload', () => {
    expect(
      parseGoalDisplayPayload('{"status":"blocked","reason":"needs a decision"}'),
    ).toEqual({ phase: 'blocked', reason: 'needs a decision' });
  });

  it('rejects a signal missing its required field', () => {
    expect(parseGoalDisplayPayload({ status: 'completed' })).toBeNull();
    expect(parseGoalDisplayPayload({ status: 'completed', summary: '   ' })).toBeNull();
    expect(parseGoalDisplayPayload({ status: 'blocked' })).toBeNull();
    expect(parseGoalDisplayPayload({ status: 'waited' })).toBeNull();
  });

  it('rejects details that are not a goal signal', () => {
    // A non-goal tool carrying an unrelated `status` must never grow a goal card.
    expect(parseGoalDisplayPayload({ status: 'ok', summary: 'wrote a file' })).toBeNull();
    expect(parseGoalDisplayPayload({ cardId: 'c1', duplicate: false })).toBeNull();
    expect(parseGoalDisplayPayload('plain tool output')).toBeNull();
    expect(parseGoalDisplayPayload(null)).toBeNull();
    expect(parseGoalDisplayPayload(undefined)).toBeNull();
    expect(parseGoalDisplayPayload([{ status: 'completed', summary: 'x' }])).toBeNull();
  });

  it('drops non-string artifact entries and negative durations', () => {
    expect(
      parseGoalDisplayPayload({
        status: 'completed',
        summary: 'Done',
        artifacts: ['a.ts', 42, '', null],
      }),
    ).toEqual({ phase: 'completed', summary: 'Done', artifacts: ['a.ts'] });
    expect(
      parseGoalDisplayPayload({ status: 'waited', reason: 'x', durationSeconds: -5 }),
    ).toEqual({ phase: 'waited', reason: 'x' });
  });
});