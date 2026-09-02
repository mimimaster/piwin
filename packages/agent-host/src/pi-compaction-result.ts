/** Translate Pi's compaction result into the product contract. */

import type { CompactionFileOps, SessionCompactResult } from '@piwin/contracts';

export type PiCompactionResult = {
  summary: string;
  tokensBefore: number;
  firstKeptEntryId?: string;
  estimatedTokensAfter?: number;
  details?: unknown;
};

export function mapPiCompactionResult(result: PiCompactionResult): SessionCompactResult {
  const fileOps = readPiCompactionFileOps(result);
  return {
    ok: true,
    summary: result.summary,
    tokensBefore: result.tokensBefore,
    ...(result.firstKeptEntryId ? { firstKeptEntryId: result.firstKeptEntryId } : {}),
    ...(typeof result.estimatedTokensAfter === 'number'
      ? { tokensAfter: result.estimatedTokensAfter }
      : {}),
    ...(fileOps ? { fileOps } : {}),
  };
}

/** Read the Pi FileOperations shape from a result or compaction event. */
export function readPiCompactionFileOps(value: unknown): CompactionFileOps | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const candidates = [record.fileOps, record.details, record];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const candidateRecord = candidate as Record<string, unknown>;
    const readFiles = readStringArray(candidateRecord.readFiles);
    const modifiedFiles = readStringArray(candidateRecord.modifiedFiles);
    if (readFiles && modifiedFiles) {
      return { readFiles, modifiedFiles };
    }
  }
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    return undefined;
  }
  return [...value];
}
