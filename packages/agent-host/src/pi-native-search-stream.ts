/** Resolve Pi's built-in lazy provider streams for native-search wrapping. */

import type {
  Api,
  Context,
  Model,
  ProviderStreams,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { NativeSearchStreamSimple } from './native-web-search.js';

export type PiNativeSearchApi =
  'openai-completions' | 'anthropic-messages' | 'google-generative-ai';

/**
 * Return the real Pi stream used by a product provider protocol.
 *
 * The public wrapper type is deliberately structural so tests and the RPC
 * envelope do not expose Pi types. At this boundary the runtime model/context
 * are the full Pi values, so the adapter narrows them back to Pi's contract.
 */
export function resolvePiNativeSearchStream(api: PiNativeSearchApi): NativeSearchStreamSimple {
  switch (api) {
    case 'openai-completions':
      return adaptPiStream(openAICompletionsApi().streamSimple);
    case 'anthropic-messages':
      return adaptPiStream(anthropicMessagesApi().streamSimple);
    case 'google-generative-ai':
      return adaptPiStream(googleGenerativeAIApi().streamSimple);
  }
}

function adaptPiStream(streamSimple: ProviderStreams['streamSimple']): NativeSearchStreamSimple {
  return (model, context, options) =>
    streamSimple(
      model as unknown as Model<Api>,
      context as Context,
      options as SimpleStreamOptions | undefined,
    );
}
