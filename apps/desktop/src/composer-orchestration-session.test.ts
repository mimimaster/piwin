import { describe, expect, it } from 'vitest';
import {
  resolveComposerOrchestrationForSessionChange,
  shouldResetComposerOrchestrationOnSessionChange,
} from './composer-orchestration-session';

const stayOnConversation = {
  skipDraftSave: false,
  preserveComposerOnSessionActivation: false,
};

describe('shouldResetComposerOrchestrationOnSessionChange', () => {
  it('keeps the pill when the active session id does not change', () => {
    expect(
      shouldResetComposerOrchestrationOnSessionChange({
        ...stayOnConversation,
        previousSessionId: 'session-a',
        nextSessionId: 'session-a',
      }),
    ).toBe(false);
  });

  it('keeps the pill when New Agent first-send creates the Host session', () => {
    expect(
      shouldResetComposerOrchestrationOnSessionChange({
        previousSessionId: null,
        nextSessionId: 'session-new',
        skipDraftSave: true,
        preserveComposerOnSessionActivation: false,
      }),
    ).toBe(false);
  });

  it('keeps the pill when a media attach creates the Host session under the same draft', () => {
    expect(
      shouldResetComposerOrchestrationOnSessionChange({
        previousSessionId: null,
        nextSessionId: 'session-new',
        skipDraftSave: false,
        preserveComposerOnSessionActivation: true,
      }),
    ).toBe(false);
  });

  it('resets when the user clicks an existing session from New Agent', () => {
    expect(
      shouldResetComposerOrchestrationOnSessionChange({
        ...stayOnConversation,
        previousSessionId: null,
        nextSessionId: 'session-b',
      }),
    ).toBe(true);
  });

  it('resets when switching between live sessions', () => {
    expect(
      shouldResetComposerOrchestrationOnSessionChange({
        ...stayOnConversation,
        previousSessionId: 'session-a',
        nextSessionId: 'session-b',
      }),
    ).toBe(true);
  });

  it('resets when opening New Agent from a live session', () => {
    expect(
      shouldResetComposerOrchestrationOnSessionChange({
        ...stayOnConversation,
        previousSessionId: 'session-a',
        nextSessionId: null,
      }),
    ).toBe(true);
  });
});

describe('resolveComposerOrchestrationForSessionChange', () => {
  it('keeps fusion on the session that armed it and does not leak it elsewhere', () => {
    const result = resolveComposerOrchestrationForSessionChange({
      previousSessionId: 'session-a',
      nextSessionId: 'session-b',
      current: { schemeId: 'fusion', delegationDisabled: false },
      parked: new Map(),
    });
    expect(result.controls).toEqual({ schemeId: 'off', delegationDisabled: false });
    expect(result.parked.get('session-a')).toEqual({
      schemeId: 'fusion',
      delegationDisabled: false,
    });
    expect(result.parked.has('session-b')).toBe(false);
  });

  it('restores fusion when returning to the session that armed it', () => {
    const parked = new Map([
      ['session-a', { schemeId: 'fusion', delegationDisabled: true }],
    ]);
    const result = resolveComposerOrchestrationForSessionChange({
      previousSessionId: 'session-b',
      nextSessionId: 'session-a',
      current: { schemeId: 'off', delegationDisabled: false },
      parked,
    });
    expect(result.controls).toEqual({ schemeId: 'fusion', delegationDisabled: true });
    expect(result.parked.get('session-a')?.schemeId).toBe('fusion');
  });

  it('opens New Agent as freehand and parks the live session scheme', () => {
    const result = resolveComposerOrchestrationForSessionChange({
      previousSessionId: 'session-a',
      nextSessionId: null,
      current: { schemeId: 'fusion', delegationDisabled: false },
      parked: new Map(),
    });
    expect(result.controls.schemeId).toBe('off');
    expect(result.parked.get('session-a')?.schemeId).toBe('fusion');
  });

  it('does not park a New Agent draft scheme onto an existing session click', () => {
    const result = resolveComposerOrchestrationForSessionChange({
      previousSessionId: null,
      nextSessionId: 'session-b',
      current: { schemeId: 'fusion', delegationDisabled: false },
      parked: new Map(),
    });
    expect(result.controls.schemeId).toBe('off');
    expect(result.parked.size).toBe(0);
  });

  it('forgets a session once the user returns it to freehand', () => {
    const result = resolveComposerOrchestrationForSessionChange({
      previousSessionId: 'session-a',
      nextSessionId: null,
      current: { schemeId: 'off', delegationDisabled: false },
      parked: new Map([['session-a', { schemeId: 'fusion', delegationDisabled: false }]]),
    });
    expect(result.parked.has('session-a')).toBe(false);
  });
});
