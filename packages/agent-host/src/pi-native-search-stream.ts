/** Resolve Pi's built-in lazy provider streams for native-search wrapping. */

import type {
  Api,
  Context,
  Model,
  ProviderStreams,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { bedrockConverseStreamApi } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
import { googleVertexApi } from '@earendil-works/pi-ai/api/google-vertex.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import type { NativeSearchStreamSimple } from './native-web-search.js';

export type PiNativeSearchApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'google-vertex'
  | 'bedrock-converse-stream';

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
      return adaptPiApiStreamSimple(openAICompletionsApi().streamSimple);
    case 'openai-responses':
      return adaptPiApiStreamSimple(openAIResponsesApi().streamSimple);
    case 'anthropic-messages':
      return adaptPiApiStreamSimple(anthropicMessagesApi().streamSimple);
    case 'google-generative-ai':
      return adaptPiApiStreamSimple(googleGenerativeAIApi().streamSimple);
    case 'google-vertex':
      return adaptPiApiStreamSimple(googleVertexApi().streamSimple);
    case 'bedrock-converse-stream':
      return adaptPiApiStreamSimple(bedrockConverseStreamApi().streamSimple);
  }
}

/** Adapt a Pi provider streamSimple to the product wrapper type. */
export function adaptPiApiStreamSimple(
  streamSimple: ProviderStreams['streamSimple'],
): NativeSearchStreamSimple {
  return (model, context, options) =>
    streamSimple(
      model as unknown as Model<Api>,
      context as Context,
      options as SimpleStreamOptions | undefined,
    );
}
