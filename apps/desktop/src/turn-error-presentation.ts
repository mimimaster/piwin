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
  const runFailed = input.runOutcome === 'failed';
  const isLastRunFailureRow = runFailed && input.isLastAssistantInTurn;
  const messageHasError = input.messageStatus === 'error' || Boolean(input.messageError);
  const isLegacyRunFailureRow = runFailed && messageHasError;
  const shouldRenderError =
    isLastRunFailureRow ||
    (messageHasError && (!isLegacyRunFailureRow || input.isLastAssistantInTurn));

  if (!shouldRenderError) {
    return null;
  }

  return (
    input.messageError ||
    (isLastRunFailureRow ? input.runTerminalMessage : undefined) ||
    (input.messageStatus === 'error' || isLastRunFailureRow
      ? input.locale === 'zh-CN'
        ? '生成失败'
        : 'Generation failed'
      : undefined) ||
    null
  );
}
