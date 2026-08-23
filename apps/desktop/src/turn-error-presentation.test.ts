import { describe, expect, it } from 'vitest';
import { resolveTurnErrorMessage } from './turn-error-presentation';

const failedRun = {
  messageStatus: 'error' as const,
  messageError: 'Provider returned error',
  runOutcome: 'failed' as const,
  runTerminalMessage: 'Provider returned error',
  locale: 'zh-CN',
};

describe('resolveTurnErrorMessage', () => {
  it('hides a run-level error from earlier assistant responses', () => {
    expect(
      resolveTurnErrorMessage({
        ...failedRun,
        isLastAssistantInTurn: false,
      }),
    ).toBeNull();
  });

  it('renders one run-level error on the last assistant response', () => {
    expect(
      resolveTurnErrorMessage({
        ...failedRun,
        isLastAssistantInTurn: true,
      }),
    ).toBe('Provider returned error');
  });

  it('keeps an independent message error visible without a failed run record', () => {
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'error',
        messageError: 'A message failed',
        runOutcome: undefined,
        runTerminalMessage: undefined,
        isLastAssistantInTurn: false,
        locale: 'en',
      }),
    ).toBe('A message failed');
  });
});
