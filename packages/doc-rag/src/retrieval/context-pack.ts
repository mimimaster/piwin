import type { ContextPack, ContextPackSource } from '@piwin/contracts';
import { countTokens } from '../chunking/tokens.js';

export const DEFAULT_CONTEXT_MAX_TOKENS = 16_000;

export function assembleContextPack(input: {
  query: string;
  folderKey: string;
  retrievalMode: ContextPack['retrievalMode'];
  degraded: boolean;
  sources: ContextPackSource[];
  maxTokens?: number;
}): ContextPack {
  const budget = input.maxTokens ?? DEFAULT_CONTEXT_MAX_TOKENS;
  const kept = [...input.sources];
  const usedTokens = (): number => kept.reduce((sum, source) => sum + countTokens(source.text), 0);
  while (usedTokens() > budget) {
    const neighborIndex = kept.findIndex((source) => source.retrievedBy === 'neighbor');
    if (neighborIndex >= 0) {
      kept.splice(neighborIndex, 1);
      continue;
    }
    if (kept.length <= 1) break;
    let lowest = 0;
    let lowestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < kept.length; index += 1) {
      const score = kept[index]?.rerankScore ?? kept[index]?.retrievalScore ?? 0;
      if (score < lowestScore) {
        lowestScore = score;
        lowest = index;
      }
    }
    kept.splice(lowest, 1);
  }

  kept.sort((left, right) => {
    if (left.documentId !== right.documentId) return left.documentId.localeCompare(right.documentId);
    return (left.startLine ?? 0) - (right.startLine ?? 0);
  });

  return {
    query: input.query,
    folderKey: input.folderKey,
    retrievalMode: input.retrievalMode,
    degraded: input.degraded,
    sources: kept,
  };
}
