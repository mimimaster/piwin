/** Narrow provider-native executor port for Host `web_search`. */

import type { ModelRef, WebSearchResult } from '@piwin/contracts';

/**
 * Provider-native executor for Host `web_search`. Returns the normalized
 * native result (grounded answer, issued queries, citations, hits) rather
 * than bare hits so provenance survives into tool cards and transcripts.
 *
 * It only executes the `native` chain step; the chain itself is derived from
 * Web config by the shared `buildSearchChain` rule.
 */
export type WebSearchModelDelegate = {
  model: ModelRef;
  search: (
    query: string,
    options: { limit: number; signal?: AbortSignal },
  ) => Promise<WebSearchResult>;
};

export function sameModelRef(left: ModelRef, right: ModelRef): boolean {
  return (
    left.protocol === right.protocol &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId
  );
}
