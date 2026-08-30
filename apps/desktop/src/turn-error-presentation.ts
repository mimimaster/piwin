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
 * Only a Host-terminalized failed Run may draw the card. Agent error events
 * are evidence for retries and must not look terminal while the Run is live.
 * Run state is shared by every assistant response in a tool loop, so a failed
 * run is rendered only on its last assistant response.
 */
export function resolveTurnErrorMessage(input: TurnErrorPresentationInput): string | null {
  if (input.runOutcome !== 'failed') {
    return null;
  }
  if (!input.isLastAssistantInTurn) {
    return null;
  }
  return (
    input.messageError ||
    input.runTerminalMessage ||
    (input.locale === 'zh-CN' ? '生成失败' : 'Generation failed')
  );
}
