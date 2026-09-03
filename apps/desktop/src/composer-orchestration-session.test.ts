import { describe, expect, it } from 'vitest';
import { shouldResetComposerOrchestrationOnSessionChange } from './composer-orchestration-session';

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
