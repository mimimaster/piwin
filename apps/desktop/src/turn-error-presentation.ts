import type { SessionRunOutcome } from '@piwin/contracts';

export type TurnErrorPresentationInput = {
  messageStatus: 'streaming' | 'done' | 'error';
  messageError: string | undefined;
  runOutcome: SessionRunOutcome | undefined;
  runTerminalMessage: string | undefined;
  isLastAssistantInTurn: boolean;
  locale: string | undefined;
};

/**
 * Resolve the one error card that belongs to a failed assistant turn.
 *
 * Run state is shared by every assistant response in a tool loop. Legacy
 * transcripts may also carry the same failure on multiple responses, so a
 * failed run is rendered only on its last assistant response.
 */
export function resolveTurnErrorMessage(input: TurnErrorPresentationInput): string | null {
  if (
    input.runOutcome === 'completed' ||
    input.runOutcome === 'cancelled' ||
    input.runOutcome === 'paused'
  ) {
    return null;
  }

  const runFailed = input.runOutcome === 'failed';
  if (runFailed) {
    if (!input.isLastAssistantInTurn) {
      return null;
    }
    return (
      input.messageError ||
      input.runTerminalMessage ||
      (input.locale === 'zh-CN' ? '生成失败' : 'Generation failed')
    );
  }

  // Live evidence stays off-screen until Host terminals the Run. Persisted
  // error rows without a run record (legacy hydrate) still render.
  if (input.messageStatus === 'streaming') {
    return null;
  }
  if (input.messageStatus !== 'error' && !input.messageError) {
    return null;
  }
  return (
    input.messageError || (input.locale === 'zh-CN' ? '生成失败' : 'Generation failed')
  );
}
