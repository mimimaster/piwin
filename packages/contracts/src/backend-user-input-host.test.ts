import { describe, expect, it } from 'vitest';
import {
  isBackendUserInputRespondCommand,
  parseBackendUserInputRequestPush,
  parseBackendUserInputSettledPush,
} from './backend-user-input-host.js';

const request = {
  title: 'Pick',
  questions: [{
    id: 'q1',
    prompt: 'Mode',
    type: 'select' as const,
    choices: [{ id: 'fast', label: 'Fast' }],
  }],
};

describe('backend user input host wire', () => {
  it('admits bounded respond commands and parses request/settled pushes', () => {
    expect(isBackendUserInputRespondCommand({
      type: 'session/backend-input-respond',
      sessionId: 's1',
      requestId: 'r1',
      generationId: 'g1',
      result: { cancelled: true },
    })).toBe(true);
    expect(isBackendUserInputRespondCommand({
      type: 'session/backend-input-respond',
      sessionId: 's1',
      requestId: 'r1',
      generationId: 'g1',
      result: { cancelled: true, answers: [] },
    })).toBe(false);

    const push = parseBackendUserInputRequestPush({
      type: 'session/backend-input-request',
      sessionId: 's1',
      requestId: 'r1',
      generationId: 'g1',
      request,
      runId: 'run-1',
    });
    expect(push?.request.questions[0]?.id).toBe('q1');

    expect(parseBackendUserInputSettledPush({
      type: 'session/backend-input-settled',
      sessionId: 's1',
      requestId: 'r1',
      generationId: 'g1',
      result: { answers: [{ questionId: 'q1', optionIds: ['fast'] }] },
    }, request)).toEqual({
      type: 'session/backend-input-settled',
      sessionId: 's1',
      requestId: 'r1',
      generationId: 'g1',
      result: { answers: [{ questionId: 'q1', optionIds: ['fast'] }] },
    });
  });
});
