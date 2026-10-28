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
  failure?: AgentFailure | undefined;
};

export type TurnErrorCardPresentation = {
  title: string;
  /** What happened and what to do next, in plain words. Null when unknown. */
  hint: string | null;
  /** Raw provider text. Folded away when a hint already says what matters. */
  detail: string;
  category: TurnErrorCategory;
  showCategoryTag: boolean;
};

type HintCopy = { zh: string; en: string };

/** Keyed by failure code: the code, not the prose, says what went wrong. */
const FAILURE_HINTS: Partial<Record<AgentFailure['code'], HintCopy>> = {
  'provider-authentication': {
    zh: '模型服务没认出密钥，或登录已过期。到模型设置里重新登录或更新密钥。',
    en: 'The model service did not accept the key, or the sign-in expired. Sign in again or update the key in model settings.',
  },
  'provider-rate-limit': {
    zh: '请求太频繁，或免费额度用完了。稍等一会儿再试，或换一个模型。',
    en: 'Too many requests, or the free allowance ran out. Wait a moment and retry, or switch models.',
  },
  'provider-quota': {
    zh: '账户额度或余额不足。到服务商那里充值，或换一个模型。',
    en: 'The account is out of quota or credit. Top up with the provider, or switch models.',
  },
  'context-limit-exceeded': {
    zh: '这段对话超出了模型的上下文窗口。压缩上下文后重试，或开一个新会话。',
    en: 'The conversation no longer fits the model’s context window. Compact it and retry, or start a new session.',
  },
  'model-stream-missing-finish': {
    zh: '模型的回复中途断了。直接重试通常就好。',
    en: 'The model’s reply broke off. Retrying usually works.',
  },
  'model-stream-stalled': {
    zh: '模型的回复中途断了。直接重试通常就好。',
    en: 'The model’s reply broke off. Retrying usually works.',
  },
  'model-request-timeout': {
    zh: '模型太久没有回应。可以重试，或换一个响应更快的模型。',
    en: 'The model took too long to answer. Retry, or switch to a faster model.',
  },
  'provider-unavailable': {
    zh: '连不上模型服务。检查网络或代理设置后重试。',
    en: 'Could not reach the model service. Check the network or proxy settings, then retry.',
  },
  'provider-http-error': {
    zh: '模型服务拒绝了这次请求，原因见详情。必要时换一个模型。',
    en: 'The model service refused this request; the details say why. Switch models if it keeps happening.',
  },
  'backend-worker-crash': {
    zh: '后台进程意外退出了。重试会重新启动它。',
    en: 'The background process exited unexpectedly. Retrying starts it again.',
  },
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
  if (input.runOutcome !== 'failed' && input.failure === undefined) {
    return null;
  }
  if (!input.isLastAssistantInTurn) {
    return null;
  }
  return (
    input.messageError ||
    input.failure?.message ||
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
  const baseDetail = extraUsageDetail ?? formatTurnErrorDetail(input.error, isChinese);
  const hintCopy = input.failure ? FAILURE_HINTS[input.failure.code] : undefined;
  const hint = extraUsageDetail
    ? null
    : input.failure?.code === 'provider-image-input-rejected'
      ? imageInputRejectedHint(isChinese)
      : hintCopy
        ? isChinese
          ? hintCopy.zh
          : hintCopy.en
        : null;
  return {
    title,
    hint,
    detail: baseDetail,
    category: classification.category,
    // "unknown" as a visible tag reads like a raw dump — hide it.
    showCategoryTag: classification.category !== 'unknown',
  };
}

/**
 * The image went out natively because the model is flagged image-capable;
 * vision delegation only runs for text-only models, so the flag is the fix.
 */
function imageInputRejectedHint(isChinese: boolean): string {
  return isChinese
    ? '这张图片以原生图片发给了模型，但模型服务拒绝了它——通常是该模型被误标为支持图片。请到模型设置中取消它的「视觉」标识；开启视觉委托后，图片会先由视觉模型转成文字再发送。'
    : 'The image was sent to the model as native image input, but the provider rejected it — usually the model is wrongly marked as image-capable. Turn off its Vision flag in model settings; with vision delegation on, images are described by the vision model first.';
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
