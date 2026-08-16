import type { PiwinConfig } from '@piwin/contracts';
import {
  buildSinglePassPrompt,
  parseDraftCardsJson,
  type DraftCardsFn,
} from '@piwin/doc-rag';
import { findEnabledProvider, resolveConfiguredDefaultModelRef } from './provider-helpers.js';
import { completeWalkthrough } from './walkthrough-completion.js';

export function createWalkthroughDraftCards(
  loadConfig: () => Promise<PiwinConfig>,
): DraftCardsFn {
  return async (request) => {
    const config = await loadConfig();
    const resolved = resolveConfiguredDefaultModelRef(config);
    if (!resolved) {
      throw new Error('GENERATION_MODEL_NOT_CONFIGURED');
    }
    const provider = findEnabledProvider(config, resolved.providerId);
    if (!provider) {
      throw new Error('GENERATION_MODEL_NOT_CONFIGURED');
    }
    const result = await completeWalkthrough({
      provider,
      modelId: resolved.modelId,
      systemPrompt: 'You write flashcards. Output a JSON array only.',
      userPrompt: buildSinglePassPrompt(request),
      maxOutputTokens: 4000,
      temperature: 0.2,
      signal: new AbortController().signal,
    });
    return parseDraftCardsJson(result.text);
  };
}
