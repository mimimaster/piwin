/**
 * Native-search facade (ADR 0043): the `streamSimple` wrapper for the Host
 * `web_search` native executor. Payload shaping lives in
 * `native-search-payload.ts`, header policy in `native-search-headers.ts`.
 *
 * Only the Host `web_search` native executor wraps its registration; main
 * sessions never carry hosted search and are not wrapped.
 */

import type {
  ModelCapability,
  NativeSearchAdapterKind,
  NativeSearchAdapterOptions,
} from '@piwin/contracts';
import { applyNativeSearchToPayload } from './native-search-payload.js';

export { applyNativeSearchToPayload } from './native-search-payload.js';

export type NativeSearchModelFlags = {
  id: string;
  capabilities?: readonly ModelCapability[];
  /** Declared request-shaping mechanism; without one nothing is injected. */
  nativeSearchAdapter?: NativeSearchAdapterKind;
  nativeSearchOptions?: NativeSearchAdapterOptions;
};

export type NativeSearchStreamOptions = {
  onPayload?: (
    payload: unknown,
    model: { id?: string; api?: string; provider?: string },
  ) => unknown | undefined | Promise<unknown | undefined>;
  [key: string]: unknown;
};

export type NativeSearchStreamSimple = (
  model: { id?: string; api?: string; provider?: string; [key: string]: unknown },
  context: unknown,
  options?: NativeSearchStreamOptions,
) => unknown;

/**
 * Wrap a provider streamSimple so every request carries the model's hosted
 * search request shape. Only the Host `web_search` native executor builds this
 * wrapper; main-session registrations are never wrapped (ADR 0043), so there
 * is nothing to strip there.
 */
export function wrapStreamSimpleForNativeSearch(
  baseStreamSimple: NativeSearchStreamSimple | undefined,
  options: {
    models: readonly NativeSearchModelFlags[];
    /** Pi's lazy protocol stream when the registration has no custom stream. */
    fallbackStreamSimple?: NativeSearchStreamSimple;
  },
): NativeSearchStreamSimple | undefined {
  const underlying = baseStreamSimple ?? options.fallbackStreamSimple;
  if (!underlying) {
    return undefined;
  }
  const modelsById = new Map(options.models.map((model) => [model.id, model]));

  return (model, context, streamOptions) => {
    const modelId = typeof model?.id === 'string' ? model.id : undefined;
    const flags = modelId ? modelsById.get(modelId) : undefined;
    const previousOnPayload = streamOptions?.onPayload;

    const nextOptions: NativeSearchStreamOptions = {
      ...(streamOptions ?? {}),
      onPayload: async (payload, payloadModel) => {
        let nextPayload = applyNativeSearchToPayload(
          payload,
          flags?.nativeSearchAdapter,
          flags?.nativeSearchOptions,
        );
        if (previousOnPayload) {
          const replaced = await previousOnPayload(nextPayload, payloadModel);
          if (replaced !== undefined) {
            nextPayload = replaced;
          }
        }
        return nextPayload;
      },
    };

    return underlying(model, context, nextOptions);
  };
}
