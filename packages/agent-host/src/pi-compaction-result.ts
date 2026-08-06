/** Translate Pi's compaction result into the product contract. */

import type { CompactionFileOps, SessionCompactResult } from '@piwin/contracts';

export type PiCompactionResult = {
  summary: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
  details?: unknown;
};

export function mapPiCompactionResult(result: PiCompactionResult): SessionCompactResult {
  const fileOps = readFileOps(result.details);
  return {
    ok: true,
    summary: result.summary,
    tokensBefore: result.tokensBefore,
    ...(typeof result.estimatedTokensAfter === 'number'
      ? { tokensAfter: result.estimatedTokensAfter }
      : {}),
    ...(fileOps ? { fileOps } : {}),
  };
}

function readFileOps(value: unknown): CompactionFileOps | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const readFiles = readStringArray(record.readFiles);
  const modifiedFiles = readStringArray(record.modifiedFiles);
  if (!readFiles || !modifiedFiles) {
    return undefined;
  }
  return { readFiles, modifiedFiles };
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    return undefined;
  }
  return [...value];
}
