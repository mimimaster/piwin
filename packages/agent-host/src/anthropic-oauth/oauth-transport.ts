import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFunction,
} from '@earendil-works/pi-ai';
import { shapeAnthropicOAuthPayload } from './request-shaping.js';

/** Anthropic OAuth access tokens use the `sk-ant-oat` prefix. */
const ANTHROPIC_OAUTH_TOKEN_MARKER = 'sk-ant-oat';

export type AnthropicStreamSimpleDelegate = StreamFunction<
  'anthropic-messages',
  SimpleStreamOptions
>;

export type AnthropicStreamSimple = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export function isAnthropicOAuthToken(apiKey: string | undefined): apiKey is string {
  return typeof apiKey === 'string' && apiKey.includes(ANTHROPIC_OAUTH_TOKEN_MARKER);
}

/**
 * Wrap Pi's Anthropic streamSimple so OAuth requests get Claude Code shaping.
 * API-key and non-Anthropic traffic pass through untouched.
 */
export function createAnthropicOAuthStreamSimple(
  delegate: AnthropicStreamSimpleDelegate,
): AnthropicStreamSimple {
  return (model, context, options) => {
    const callerOnPayload = options?.onPayload;

    const onPayload: SimpleStreamOptions['onPayload'] = async (payload, payloadModel) => {
      const upstream = callerOnPayload
        ? ((await callerOnPayload(payload, payloadModel)) ?? payload)
        : payload;

      if (!isAnthropicOAuthToken(options?.apiKey)) {
        return upstream;
      }

      return shapeAnthropicOAuthPayload(upstream);
    };

    return delegate(model as Model<'anthropic-messages'>, context, {
      ...options,
      onPayload,
    });
  };
}
