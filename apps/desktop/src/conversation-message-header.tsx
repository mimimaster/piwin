import type { ReactElement } from 'react';
import type { ContextUsageSnapshot, ModelProviderConfig, ModelRef } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';
import {
  conversationUsageEstimatedLabel,
  formatUsageDurationMs,
  formatUsageTokenCount,
  isHostEstimatedUsage,
} from './conversation-usage-copy';
import {
  formatMessageTime,
  resolveConversationMessageModel,
  resolveModelDisplayName,
} from './conversation-message-identity';
import type { ModelOption } from './model-options';
import { ProviderIcon } from '@piwin/ui-kit';
import { ReplyWriterChip, type ReplyWriterChipSource } from './reply-writer-chip';

export type ConversationUsageChipData = {
  text: string;
  isEstimated?: boolean;
  tooltip?: string;
};

/** Rewrite state shown on the header; may come from another row of the turn. */
export type ConversationReplyWriterSource = ReplyWriterChipSource;

export type ConversationMessageHeaderProps = {
  message: ChatMessageUi;
  replyWriterSource?: ConversationReplyWriterSource | null;
  model?: ModelRef;
  providerName?: string;
  shortModelName?: string;
  modelLabel?: string;
  usageChip?: ConversationUsageChipData | null;
  locale?: 'zh-CN' | 'en';
};

export type ConversationTurnIdentityHeaderProps = {
  message: ChatMessageUi;
  replyWriterSource?: ConversationReplyWriterSource | null;
  livePromptModel?: ModelRef | null;
  turnStreaming: boolean;
  modelOptions?: readonly ModelOption[];
  configProviders?: readonly ModelProviderConfig[];
  usageChip?: ConversationUsageChipData | null;
  locale: 'zh-CN' | 'en';
};

/**
 * Construct turn usage chip for the latest completed assistant message.
 * Only accepts `assistant-usage` or `host-estimate` sources (never `pi-contextUsage`).
 */
export function buildConversationTurnUsageChip(
  usage: ContextUsageSnapshot | null | undefined,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): ConversationUsageChipData | null {
  if (!usage) return null;
  if (usage.source !== 'assistant-usage' && usage.source !== 'host-estimate') {
    return null;
  }

  const isEstimated = isHostEstimatedUsage(usage);
  const prompt =
    typeof usage.promptTokens === 'number' ? formatUsageTokenCount(usage.promptTokens) : undefined;
  const completion =
    typeof usage.completionTokens === 'number'
      ? formatUsageTokenCount(usage.completionTokens)
      : undefined;
  const total =
    typeof usage.totalTokens === 'number' ? formatUsageTokenCount(usage.totalTokens) : undefined;

  let text = '';
  if (prompt && completion) {
    text = `${prompt} → ${completion}`;
  } else if (total) {
    text = total;
  } else if (prompt) {
    text = prompt;
  } else if (completion) {
    text = completion;
  } else {
    return null;
  }

  if (isEstimated) {
    text = `~${text}`;
  }

  const duration =
    typeof usage.durationMs === 'number' ? ` (${formatUsageDurationMs(usage.durationMs)})` : '';
  const estSuffix = isEstimated ? ` · ${conversationUsageEstimatedLabel(locale)}` : '';
  const tooltip = `${text}${duration}${estSuffix}`;

  return {
    text,
    isEstimated,
    tooltip,
  };
}

export function ConversationMessageHeader(props: ConversationMessageHeaderProps): ReactElement {
  const { message, model, providerName, shortModelName, modelLabel, usageChip } = props;
  const formattedTime = formatMessageTime(message.createdAt);
  const replyWriter = props.replyWriterSource ?? message;

  return (
    <div className="conversation-message-header" data-testid="conversation-message-header">
      <div className="conversation-message-identity">
        {model ? (
          <>
            <ProviderIcon
              id={model.providerId}
              modelId={model.modelId}
              {...(providerName !== undefined ? { name: providerName } : {})}
              size={32}
              fallback="model"
              className="conversation-message-provider-icon"
            />
            <span
              className="conversation-message-model-name"
              title={modelLabel || model.modelId}
              data-testid="conversation-message-model-name"
            >
              {shortModelName || model.modelId}
            </span>
            {providerName ? (
              <span
                className="conversation-message-provider-name conversation-message-provider-badge"
                data-testid="conversation-message-provider-name"
              >
                {providerName}
              </span>
            ) : null}
          </>
        ) : null}
        {formattedTime ? (
          <span className="conversation-message-time" data-testid="conversation-message-time">
            {formattedTime}
          </span>
        ) : null}
        <ReplyWriterChip source={replyWriter} locale={props.locale ?? 'zh-CN'} />
      </div>

      {usageChip ? (
        <span
          className={`conversation-message-usage-chip${usageChip.isEstimated ? ' is-estimated' : ''}`}
          data-testid="conversation-message-usage-chip"
          title={usageChip.tooltip}
        >
          {usageChip.text}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Turn-level identity chrome. Rendered above work disclosure whenever the
 * first visible assistant lives inside the folded work range, so expanding
 * work details cannot move the avatar under the trigger.
 */
export function ConversationTurnIdentityHeader(
  props: ConversationTurnIdentityHeaderProps,
): ReactElement {
  const resolvedModel = resolveConversationMessageModel({
    message: props.message,
    livePromptModel: props.livePromptModel ?? null,
    isStreaming: props.turnStreaming || props.message.status === 'streaming',
  });
  const modelDisplay = resolvedModel
    ? resolveModelDisplayName({
        model: resolvedModel,
        ...(props.modelOptions !== undefined ? { modelOptions: props.modelOptions } : {}),
        ...(props.configProviders !== undefined ? { configProviders: props.configProviders } : {}),
      })
    : undefined;

  return (
    <div
      className="conversation-response conversation-turn-identity"
      data-testid="conversation-turn-identity"
    >
      <ConversationMessageHeader
        message={props.message}
        {...(props.replyWriterSource ? { replyWriterSource: props.replyWriterSource } : {})}
        {...(resolvedModel !== undefined ? { model: resolvedModel } : {})}
        {...(modelDisplay?.providerName !== undefined
          ? { providerName: modelDisplay.providerName }
          : {})}
        {...(modelDisplay?.shortModelName !== undefined
          ? { shortModelName: modelDisplay.shortModelName }
          : {})}
        {...(modelDisplay?.modelLabel !== undefined ? { modelLabel: modelDisplay.modelLabel } : {})}
        {...(props.usageChip !== undefined ? { usageChip: props.usageChip } : {})}
        locale={props.locale}
      />
    </div>
  );
}
