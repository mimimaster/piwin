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

  it('hides message error evidence until Host fails the Run', () => {
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'error',
        messageError: 'A message failed',
        runOutcome: undefined,
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'streaming',
        messageError: 'Provider returned error',
        runOutcome: undefined,
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'done',
        messageError: 'Connection error.',
        runOutcome: undefined,
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
  });

  it('hides leftover evidence after a completed or cancelled Run', () => {
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'error',
        messageError: 'The operation was aborted',
        runOutcome: 'cancelled',
        runTerminalMessage: 'Stopped',
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'done',
        messageError: 'Provider returned error',
        runOutcome: 'completed',
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'en',
      }),
    ).toBeNull();
  });

  it('falls back to a locale default when the failed Run has no prose', () => {
    expect(
      resolveTurnErrorMessage({
        messageStatus: 'done',
        messageError: undefined,
        runOutcome: 'failed',
        runTerminalMessage: undefined,
        isLastAssistantInTurn: true,
        locale: 'zh-CN',
      }),
    ).toBe('生成失败');
  });
});
