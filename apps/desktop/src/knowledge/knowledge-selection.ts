/**
 * Selection / sidebar status helpers for the knowledge ingest loop.
 * Keeps default selection within index caps and prefers already-READY docs.
 */
import type { DocumentManifest, IngestionJob, ScannedDocFile } from '@piwin/contracts';
import { DEFAULT_MAX_FILES } from '@piwin/contracts';
import type { KnowledgeLoopStage } from './knowledge-loop-state.js';

export function readyRelativePaths(documents: DocumentManifest[]): Set<string> {
  return new Set(
    documents.filter((document) => document.status === 'READY').map((document) => document.relativePath),
  );
}

/**
 * Default checkbox set after scan/load:
 * - If any READY docs overlap the scan, select those (so partial indexes unstick).
 * - Otherwise select the first `maxFiles` scanned paths (host ingest cap).
 */
export function defaultSelectedSupportedPaths(
  files: ScannedDocFile[],
  documents: DocumentManifest[],
  maxFiles: number = DEFAULT_MAX_FILES,
): string[] {
  const scanned = files.map((file) => file.relativePath);
  const scannedSet = new Set(scanned);
  const ready = [...readyRelativePaths(documents)].filter((path) => scannedSet.has(path));
  if (ready.length > 0) {
    return ready;
  }
  const limit = Math.max(0, Math.floor(maxFiles));
  return scanned.slice(0, limit);
}

export function deriveProjectIndexStatus(input: {
  stage: KnowledgeLoopStage;
  readyCount: number;
  scannedCount: number;
}): 'ready' | 'indexing' | 'unindexed' {
  if (input.stage === 'indexing') return 'indexing';
  if (
    input.stage === 'ready' ||
    input.stage === 'result' ||
    input.stage === 'generating' ||
    input.readyCount > 0
  ) {
    return 'ready';
  }
  return 'unindexed';
}

export function formatIndexCapHint(
  scannedCount: number,
  maxFiles: number = DEFAULT_MAX_FILES,
  locale: 'zh-CN' | 'en' = 'en',
): string | null {
  if (scannedCount <= maxFiles) return null;
  if (locale === 'zh-CN') {
    return `扫描到 ${scannedCount} 个文件，单次入库上限 ${maxFiles}。已默认只勾选可入库的部分；可取消勾选后改选其他文件再入库。`;
  }
  return `Scanned ${scannedCount} files; ingest caps at ${maxFiles} per run. Only a capped selection is checked by default—adjust and index again for the rest.`;
}

export function formatIngestionWarnings(
  warnings: IngestionJob['warnings'] | undefined,
): string | null {
  if (!warnings || warnings.length === 0) return null;
  const messages = warnings
    .map((warning) => warning.message.trim())
    .filter((message) => message.length > 0);
  if (messages.length === 0) return null;
  // Cap display so a 2000-file failure dump does not flood the hero.
  const shown = messages.slice(0, 8);
  const extra = messages.length - shown.length;
  return extra > 0 ? `${shown.join('\n')}\n(+${extra} more)` : shown.join('\n');
}
