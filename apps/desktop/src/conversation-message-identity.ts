/**
 * Conversation message identity resolution.
 *
 * Resolves short model names, provider display names, and message model
 * snapshots without leaking current composer state into historic turns.
 */
import type { ModelProviderConfig, ModelRef } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';
import type { ModelOption } from './model-options';

const MAX_SHORT_MODEL_NAME_CHARS = 28;

/**
 * Format ISO timestamp to `HH:MM`. Returns empty string on missing or invalid timestamps.
 */
export function formatMessageTime(createdAt?: string): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return '';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Extract a human-readable short model name from a model ID or label.
 * Strips organisation prefix (e.g. `anthropic/claude-sonnet-4` → `claude-sonnet-4`)
 * and performs middle-ellipsis if excessively long.
 */
export function resolveShortModelName(rawModelName: string): string {
  const trimmed = rawModelName.trim();
  if (!trimmed) return '';

  // Take the segment after the last slash or colon prefix (e.g. org/model -> model)
  const segments = trimmed.split(/[\\/]/);
  const lastSegment = segments[segments.length - 1]?.trim() || trimmed;

  if (lastSegment.length <= MAX_SHORT_MODEL_NAME_CHARS) {
    return lastSegment;
  }

  // Middle-ellipsis: e.g. "anthropic-claude-3-5-sonnet-20241022" -> "anthropic-claude…20241022"
  const startChars = Math.floor((MAX_SHORT_MODEL_NAME_CHARS - 1) / 2);
  const endChars = MAX_SHORT_MODEL_NAME_CHARS - 1 - startChars;
  return `${lastSegment.slice(0, startChars)}…${lastSegment.slice(-endChars)}`;
}

export type ResolveModelDisplayNameInput = {
  model: ModelRef;
  modelOptions?: readonly ModelOption[];
  configProviders?: readonly ModelProviderConfig[];
};

export type ResolvedModelDisplay = {
  modelLabel: string;
  shortModelName: string;
  providerName: string;
};

/**
 * Resolve display name and short label for a ModelRef.
 * Checks active model options / config providers, then falls back to IDs.
 */
export function resolveModelDisplayName(input: ResolveModelDisplayNameInput): ResolvedModelDisplay {
  const { model, modelOptions, configProviders } = input;

  let modelLabel = model.modelId;
  let providerName = model.providerId;

  // 1. Check configured modelOptions
  const matchedOption = modelOptions?.find(
    (opt) => opt.providerId === model.providerId && opt.modelId === model.modelId,
  );
  if (matchedOption?.label) {
    modelLabel = matchedOption.label;
  }

  // 2. Check provider config for custom provider name & model label
  const matchedProvider = configProviders?.find((p) => p.id === model.providerId);
  if (matchedProvider) {
    if (matchedProvider.name) {
      providerName = matchedProvider.name;
    }
    const modelEntry = matchedProvider.models?.find((m) => m.id === model.modelId);
    if (modelEntry?.label) {
      modelLabel = modelEntry.label;
    }
  }

  const shortModelName = resolveShortModelName(modelLabel);

  return {
    modelLabel,
    shortModelName,
    providerName,
  };
}

export type ResolveConversationMessageModelInput = {
  message: ChatMessageUi;
  livePromptModel?: ModelRef | null;
  isStreaming?: boolean;
};

/**
 * Resolve model identity for a conversation message.
 *
 * Rules:
 * 1. If the message has a persisted `model` snapshot, always use it.
 * 2. If no snapshot exists AND this row is actively streaming, fallback to `livePromptModel`.
 * 3. Completed historic rows without a snapshot stay unlabeled.
 *    NEVER backfill from the current composer model selection.
 *
 * `isStreaming` on ConversationResponseContent is the session-level run flag
 * (true for every row while a turn is live). Historic identity uses the row's
 * own `status`, not that session flag.
 */
export function resolveConversationMessageModel(
  input: ResolveConversationMessageModelInput,
): ModelRef | undefined {
  if (input.message.model) {
    return input.message.model;
  }

  if (input.message.status === 'streaming' && input.livePromptModel) {
    return input.livePromptModel;
  }

  return undefined;
}
