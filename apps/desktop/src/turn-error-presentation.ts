import {
  formatAnthropicExtraUsageError,
  type AgentFailure,
  type SessionRunOutcome,
} from '@piwin/contracts';
import {
  classifyAgentFailure,
  type TurnErrorCategory,
} from './turn-error-classification.js';

export type TurnErrorPresentationInput = {
  messageStatus: 'streaming' | 'done' | 'error';
  messageError: string | undefined;
  runOutcome: SessionRunOutcome | undefined;
  runTerminalMessage: string | undefined;
  isLastAssistantInTurn: boolean;
  locale: string | undefined;
};

export type TurnErrorCardPresentation = {
  title: string;
  detail: string;
  category: TurnErrorCategory;
  showCategoryTag: boolean;
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

/** Strip a leading machine label so the shaded well shows the payload. */
const UNKNOWN_LABEL_PREFIX =
  /^(?:unknown(?:-agent-failure)?|error)\s*:\s*/i;

/** Only these empty shells become the "no further details" fallback. */
const EMPTY_DETAIL =
  /^(?:unknown(?:-agent-failure)?|error|unknown agent failure|generation failed|生成失败)\.?$/i;

/**
 * Title + shaded-detail copy for the transcript error card.
 *
 * Structured AgentFailure drives the title. Vague "Unknown: …" / "Error"
 * prose is intercepted so the title stays human and the detail box holds
 * the concrete message (or a short fallback).
 */
export function presentTurnErrorCard(input: {
  error: string;
  failure?: AgentFailure | undefined;
  locale?: string | undefined;
}): TurnErrorCardPresentation {
  const isChinese =
    input.locale === undefined ||
    input.locale === 'zh-CN' ||
    input.locale.startsWith('zh');
  const classification = classifyAgentFailure(input.failure);
  const extraUsageDetail =
    formatAnthropicExtraUsageError(input.error, isChinese ? 'zh-CN' : 'en') ??
    (input.failure
      ? formatAnthropicExtraUsageError(input.failure.message, isChinese ? 'zh-CN' : 'en')
      : undefined);
  const title = extraUsageDetail
    ? isChinese
      ? '需开通 extra usage'
      : 'Extra usage required'
    : isChinese
      ? classification.titleZh
      : classification.titleEn;
  const detail = extraUsageDetail ?? formatTurnErrorDetail(input.error, isChinese);
  return {
    title,
    detail,
    category: classification.category,
    // "unknown" as a visible tag reads like a raw dump — hide it.
    showCategoryTag: classification.category !== 'unknown',
  };
}

function formatTurnErrorDetail(error: string, isChinese: boolean): string {
  const trimmed = error.trim();
  if (trimmed.length === 0 || EMPTY_DETAIL.test(trimmed)) {
    return isChinese ? '没有更多详细信息。' : 'No further details available.';
  }
  const withoutLabel = trimmed.replace(UNKNOWN_LABEL_PREFIX, '').trim();
  if (withoutLabel.length === 0 || EMPTY_DETAIL.test(withoutLabel)) {
    return isChinese ? '没有更多详细信息。' : 'No further details available.';
  }
  return withoutLabel;
}
