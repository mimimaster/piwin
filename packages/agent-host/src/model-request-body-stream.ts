/**
 * Applies each model's custom request body (ADR 0095) through Pi's
 * `onPayload` hook, which every Pi wire (OpenAI Chat/Responses, Anthropic,
 * Gemini, Vertex, Bedrock) calls with the final payload before sending.
 *
 * This wrapper sits directly over the Pi stream so its hook is the one Pi
 * invokes: every outer hook (native search, Gemini isolation, cloud thinking
 * rewrites, caller hooks) runs first and the user's body is merged last.
 */
import { mergeModelRequestBody, type ModelRequestBody } from '@piwin/contracts';
import type { NativeSearchStreamOptions, NativeSearchStreamSimple } from './native-web-search.js';

export type ModelRequestBodyFlags = {
  id: string;
  extraBody?: ModelRequestBody;
};

/** Undefined input → undefined; no model with a body → the stream itself. */
export function wrapStreamSimpleForModelRequestBody(
  underlying: NativeSearchStreamSimple | undefined,
  models: readonly ModelRequestBodyFlags[],
): NativeSearchStreamSimple | undefined {
  if (!underlying) return undefined;
  const bodiesById = new Map<string, ModelRequestBody>();
  for (const model of models) {
    if (model.extraBody) bodiesById.set(model.id, model.extraBody);
  }
  if (bodiesById.size === 0) return underlying;

  return (model, context, streamOptions) => {
    const modelId = typeof model?.id === 'string' ? model.id : undefined;
    const extraBody = modelId ? bodiesById.get(modelId) : undefined;
    if (!extraBody) return underlying(model, context, streamOptions);
    const previousOnPayload = streamOptions?.onPayload;
    const nextOptions: NativeSearchStreamOptions = {
      ...(streamOptions ?? {}),
      onPayload: async (payload, payloadModel) => {
        const upstream = previousOnPayload
          ? ((await previousOnPayload(payload, payloadModel)) ?? payload)
          : payload;
        return mergeModelRequestBody(upstream, extraBody);
      },
    };
    return underlying(model, context, nextOptions);
  };
}
