/**
 * Token split normalization for usage accounting.
 *
 * Piwin follows Pi's split: `promptTokens` is uncached input only, and
 * `totalTokens = prompt + completion + cacheRead + cacheWrite`. Some external
 * agent backends report OpenAI-style usage instead, where `promptTokens`
 * already includes the cached part and `totalTokens = prompt + completion`.
 * Summing those rows as-is counts cache twice in direct input and in the
 * cache-hit denominator, and makes the row unpriceable.
 */

/** The token fields a usage row carries; every usage record shape has them. */
export type UsageTokenSplit = {
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
};

/**
 * Rewrite a cache-inclusive prompt count into Pi's uncached split.
 *
 * The inclusive form is only recognized when it is unambiguous: cache tokens
 * are present, the total equals prompt + completion exactly, and the prompt is
 * large enough to contain the cache. A Pi-split row with cache never satisfies
 * `total === prompt + completion`, so it is returned unchanged. The total is
 * kept, since it already counts every token once.
 */
export function normalizeUsageTokenSplit<T extends UsageTokenSplit>(usage: T): T {
  const { promptTokens, completionTokens } = usage;
  if (promptTokens === undefined || completionTokens === undefined) return usage;
  const cacheTokens = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  if (cacheTokens <= 0 || promptTokens < cacheTokens) return usage;
  if (usage.totalTokens !== promptTokens + completionTokens) return usage;
  return { ...usage, promptTokens: promptTokens - cacheTokens };
}
