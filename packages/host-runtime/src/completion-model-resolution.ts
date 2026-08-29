/**
 * Shared model/provider resolution for non-session completions
 * (Walkthrough and flashcard selection tutor).
 */
import type { ModelProviderConfig, ModelRef, PiwinConfig } from '@piwin/contracts';
import { findEnabledProvider, resolveConfiguredDefaultModelRef } from './provider-helpers.js';

export type CompletionProviderResolutionError =
  | 'provider-not-found'
  | 'unsupported-provider'
  | 'model-not-configured';

export type CompletionProviderResolution =
  | { provider: ModelProviderConfig }
  | { error: CompletionProviderResolutionError };

/**
 * Validates that a ModelRef points to a configured, enabled provider and that
 * the provider protocol matches. Walkthrough maps the error codes as-is.
 */
export function resolveProviderForModel(
  model: ModelRef,
  config: PiwinConfig,
): CompletionProviderResolution {
  const provider = findEnabledProvider(config, model.providerId);
  if (!provider) {
    return { error: 'provider-not-found' };
  }
  if (provider.protocol !== model.protocol) {
    return { error: 'unsupported-provider' };
  }
  const modelExists = provider.models.some((entry) => entry.id === model.modelId);
  if (!modelExists) {
    return { error: 'model-not-configured' };
  }
  return { provider };
}

const STRUCTURED_COMPLETION_PROTOCOLS = new Set<ModelProviderConfig['protocol']>([
  'openai-compatible',
  'anthropic-compatible',
  'google-gemini',
]);

export function isStructuredCompletionProtocol(
  protocol: ModelProviderConfig['protocol'],
): boolean {
  return STRUCTURED_COMPLETION_PROTOCOLS.has(protocol);
}

export type FlashcardSelectionModelResolution =
  | { model: ModelRef; provider: ModelProviderConfig }
  | { error: 'flashcard-selection-model-unavailable' };

export type FlashcardSelectionModelRequest = {
  config: PiwinConfig;
  resolveSessionModel: (sessionId: string) => ModelRef | undefined;
  model?: ModelRef;
  sessionId?: string;
};

function providerSupportsStructuredCompletion(provider: ModelProviderConfig): boolean {
  return isStructuredCompletionProtocol(provider.protocol) && provider.baseUrl.trim().length > 0;
}

function tryResolveCandidate(
  model: ModelRef,
  config: PiwinConfig,
): FlashcardSelectionModelResolution | undefined {
  const resolved = resolveProviderForModel(model, config);
  if ('error' in resolved) return undefined;
  if (!providerSupportsStructuredCompletion(resolved.provider)) return undefined;
  return { model, provider: resolved.provider };
}

/**
 * Flashcard tutor resolution: command model, then session model, then the
 * configured default chat model. Never falls back to an arbitrary provider.
 * An explicit command model that fails validation is not replaced.
 */
export function resolveFlashcardSelectionCompletionModel(
  request: FlashcardSelectionModelRequest,
): FlashcardSelectionModelResolution {
  if (request.model) {
    return (
      tryResolveCandidate(request.model, request.config) ?? {
        error: 'flashcard-selection-model-unavailable',
      }
    );
  }

  if (request.sessionId) {
    const sessionModel = request.resolveSessionModel(request.sessionId);
    if (sessionModel) {
      const resolved = tryResolveCandidate(sessionModel, request.config);
      if (resolved) return resolved;
    }
  }

  const configured = resolveConfiguredDefaultModelRef(request.config);
  if (configured) {
    const resolved = tryResolveCandidate(configured, request.config);
    if (resolved) return resolved;
  }

  return { error: 'flashcard-selection-model-unavailable' };
}
