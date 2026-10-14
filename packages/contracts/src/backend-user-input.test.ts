import { describe, expect, it } from 'vitest';
import {
  BACKEND_USER_INPUT_MAX_QUESTIONS,
  parseBackendUserInputRequest,
  parseBackendUserInputResult,
  type BackendUserInputRequest,
} from './backend-user-input.js';

function request(overrides: Partial<BackendUserInputRequest> = {}): BackendUserInputRequest {
  return {
    title: 'Choose a path',
    questions: [
      { id: 'q-text', prompt: 'Name', type: 'text' },
      {
        id: 'q-select',
        prompt: 'Mode',
        type: 'select',
        choices: [
          { id: 'fast', label: 'Fast' },
          { id: 'careful', label: 'Careful', description: 'slower' },
        ],
        allowOther: true,
      },
    ],
    ...overrides,
  };
}

describe('backend user input', () => {
  it('parses a bounded request and preserves selected option ids verbatim', () => {
    const parsed = parseBackendUserInputRequest(request());
    expect(parsed?.questions).toHaveLength(2);
    const result = parseBackendUserInputResult({
      answers: [
        { questionId: 'q-text', text: 'alpha' },
        { questionId: 'q-select', optionIds: ['careful'], otherText: 'custom' },
      ],
    }, parsed!);
    expect(result).toEqual({
      answers: [
        { questionId: 'q-text', text: 'alpha' },
        { questionId: 'q-select', optionIds: ['careful'], otherText: 'custom' },
      ],
    });
    expect(parseBackendUserInputResult({ cancelled: true }, parsed!)).toEqual({ cancelled: true });
  });

  it('rejects unknown keys, duplicate ids, illegal otherText and cancelled+answers', () => {
    expect(parseBackendUserInputRequest({ ...request(), schema: 1 })).toBeUndefined();
    expect(parseBackendUserInputRequest({
      title: 'x',
      questions: [
        { id: 'dup', prompt: 'a', type: 'text' },
        { id: 'dup', prompt: 'b', type: 'text' },
      ],
    })).toBeUndefined();
    expect(parseBackendUserInputRequest({
      title: 'x',
      questions: [{
        id: 'q1',
        prompt: 'Pick',
        type: 'select',
        choices: [
          { id: 'same', label: 'A' },
          { id: 'same', label: 'B' },
        ],
      }],
    })).toBeUndefined();
    const dupChoice = parseBackendUserInputRequest({
      title: 'x',
      questions: [{
        id: 'q1',
        prompt: 'Pick',
        type: 'select',
        multiple: true,
        choices: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      }],
    })!;
    expect(parseBackendUserInputResult({
      answers: [{ questionId: 'q1', optionIds: ['a', 'a'] }],
    }, dupChoice)).toBeUndefined();
    expect(parseBackendUserInputRequest({
      title: 'x',
      questions: Array.from({ length: BACKEND_USER_INPUT_MAX_QUESTIONS + 1 }, (_, index) => ({
        id: `q${index}`,
        prompt: `Q${index}`,
        type: 'text' as const,
      })),
    })).toBeUndefined();

    const parsed = parseBackendUserInputRequest(request({
      questions: [{
        id: 'q-select',
        prompt: 'Mode',
        type: 'select',
        choices: [{ id: 'fast', label: 'Fast' }],
      }],
    }))!;
    expect(parseBackendUserInputResult({
      answers: [{ questionId: 'q-select', optionIds: ['fast'], otherText: 'nope' }],
    }, parsed)).toBeUndefined();
    expect(parseBackendUserInputResult({
      answers: [{ questionId: 'q-select', optionIds: ['missing'] }],
    }, parsed)).toBeUndefined();
    expect(parseBackendUserInputResult({
      cancelled: true,
      answers: [{ questionId: 'q-select', optionIds: ['fast'] }],
    }, parsed)).toBeUndefined();
    expect(parseBackendUserInputResult({
      answers: [{ questionId: 'q-select', text: 'wrong-type' }],
    }, parsed)).toBeUndefined();
  });

  it('enforces required defaults and multiple-select rules', () => {
    const required = parseBackendUserInputRequest({
      title: 'Need answer',
      questions: [{
        id: 'q1',
        prompt: 'Pick',
        type: 'select',
        choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      }],
    })!;
    expect(parseBackendUserInputResult({ answers: [{ questionId: 'q1', optionIds: [] }] }, required)).toBeUndefined();
    expect(parseBackendUserInputResult({
      answers: [{ questionId: 'q1', optionIds: ['a', 'b'] }],
    }, required)).toBeUndefined();

    const multi = parseBackendUserInputRequest({
      title: 'Multi',
      questions: [{
        id: 'q1',
        prompt: 'Pick',
        type: 'select',
        multiple: true,
        required: false,
        choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      }],
    })!;
    expect(parseBackendUserInputResult({
      answers: [{ questionId: 'q1', optionIds: ['b', 'a'] }],
    }, multi)).toEqual({
      answers: [{ questionId: 'q1', optionIds: ['b', 'a'] }],
    });
    expect(parseBackendUserInputResult({
      answers: [{ questionId: 'q1', optionIds: [] }],
    }, multi)).toEqual({
      answers: [{ questionId: 'q1', optionIds: [] }],
    });
  });
});
