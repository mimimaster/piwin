import {
  isGeminiOpenAiCompatModelId,
  wrapStreamSimpleForGeminiOpenAiSession,
} from './gemini-openai-session-isolation.js';
import {
  wrapStreamSimpleForNativeSearch,
  type NativeSearchModelFlags,
  type NativeSearchStreamSimple,
} from './native-web-search.js';
import { resolvePiNativeSearchStream, type PiNativeSearchApi } from './pi-native-search-stream.js';
import { wrapStreamSimpleForRequestTiming } from './stream-request-timing.js';

export function resolveProviderStreamSimple(input: {
  api: PiNativeSearchApi;
  models: readonly NativeSearchModelFlags[];
  streamSimple?: NativeSearchStreamSimple;
  /** Host `web_search` native executor only; main sessions never inject hosted search. */
  injectNativeSearch?: boolean;
}): NativeSearchStreamSimple | undefined {
  const needsSearch = input.injectNativeSearch === true;
  const needsGeminiIsolation =
    input.api === 'openai-completions' &&
    input.models.some((model) => isGeminiOpenAiCompatModelId(model.id));
  if (!needsSearch && !needsGeminiIsolation) {
    return wrapStreamSimpleForRequestTiming(input.streamSimple ?? resolvePiNativeSearchStream(input.api));
  }
  const fallback = resolvePiNativeSearchStream(input.api);
  let stream = input.streamSimple;
  if (needsSearch) {
    stream =
      wrapStreamSimpleForNativeSearch(stream, {
        models: input.models,
        fallbackStreamSimple: fallback,
      }) ?? stream;
  }
  if (needsGeminiIsolation) {
    stream =
      wrapStreamSimpleForGeminiOpenAiSession(stream, {
        fallbackStreamSimple: fallback,
      }) ?? stream;
  }
  return wrapStreamSimpleForRequestTiming(stream ?? fallback);
}

export type RegistrationModelStreamFlags = NativeSearchModelFlags & { api: PiNativeSearchApi };

/**
 * Registration-level stream for a provider whose models may use different Pi
 * APIs (ADR 0079 per-model protocol). One provider protocol → the plain
 * provider stream; mixed → a dispatcher keyed by the requested model's `api`.
 */
export function resolveRegistrationStreamSimple(input: {
  defaultApi: PiNativeSearchApi;
  models: readonly RegistrationModelStreamFlags[];
  streamSimple?: NativeSearchStreamSimple;
  injectNativeSearch?: boolean;
}): NativeSearchStreamSimple | undefined {
  const apis = new Set<PiNativeSearchApi>([input.defaultApi, ...input.models.map((model) => model.api)]);
  const streamFor = (api: PiNativeSearchApi): NativeSearchStreamSimple | undefined =>
    resolveProviderStreamSimple({
      api,
      models: input.models.filter((model) => model.api === api),
      // A caller-supplied base stream speaks the provider protocol only.
      ...(api === input.defaultApi && input.streamSimple ? { streamSimple: input.streamSimple } : {}),
      ...(input.injectNativeSearch ? { injectNativeSearch: true } : {}),
    });
  if (apis.size === 1) {
    return streamFor(input.defaultApi);
  }
  const streams = new Map<PiNativeSearchApi, NativeSearchStreamSimple>();
  for (const api of apis) {
    const stream = streamFor(api);
    if (stream) streams.set(api, stream);
  }
  return (model, context, options) => {
    const requested = typeof model?.api === 'string' ? (model.api as PiNativeSearchApi) : input.defaultApi;
    const stream = streams.get(requested) ?? streams.get(input.defaultApi);
    if (!stream) {
      throw new Error(`no Pi stream registered for api ${requested}`);
    }
    return stream(model, context, options);
  };
}
