import type { ResolvedSearchRoute } from '@piwin/contracts';
import {
  isGeminiOpenAiCompatModelId,
  wrapStreamSimpleForGeminiOpenAiSession,
} from './gemini-openai-session-isolation.js';
import {
  providerNeedsNativeSearchWrapper,
  wrapStreamSimpleForNativeSearch,
  type NativeSearchModelFlags,
  type NativeSearchStreamSimple,
} from './native-web-search.js';
import { resolvePiNativeSearchStream } from './pi-native-search-stream.js';

export function resolveProviderStreamSimple(input: {
  api: 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';
  models: readonly NativeSearchModelFlags[];
  searchRoute?: ResolvedSearchRoute | null;
  streamSimple?: NativeSearchStreamSimple;
}): NativeSearchStreamSimple | undefined {
  const needsSearch = providerNeedsNativeSearchWrapper(input.models, input.searchRoute);
  const needsGeminiIsolation =
    input.api === 'openai-completions' &&
    input.models.some((model) => isGeminiOpenAiCompatModelId(model.id));
  if (!needsSearch && !needsGeminiIsolation) {
    return input.streamSimple;
  }
  const fallback = resolvePiNativeSearchStream(input.api);
  let stream = input.streamSimple;
  if (needsSearch) {
    stream =
      wrapStreamSimpleForNativeSearch(stream, {
        models: input.models,
        searchRoute: input.searchRoute ?? null,
        fallbackStreamSimple: fallback,
      }) ?? stream;
  }
  if (needsGeminiIsolation) {
    stream =
      wrapStreamSimpleForGeminiOpenAiSession(stream, {
        fallbackStreamSimple: fallback,
      }) ?? stream;
  }
  return stream;
}
