/**
 * The library reader unmounts when the composer takes the main column.
 * Remember which document was open so opening Knowledge again lands on it
 * (and after send, the user can return to the same place).
 */

export type KnowledgeReaderReturn = {
  baseId: string;
  relativePath: string;
  title: string;
  indexed: boolean;
  chunkCount: number;
  /** Independent assist session for this document; resume after reconnect. */
  assistSessionId?: string;
};

const STORAGE_KEY = 'piwin:knowledge-reader-return';

export function rememberKnowledgeReaderReturn(target: KnowledgeReaderReturn): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
}

export function readKnowledgeReaderReturn(): KnowledgeReaderReturn | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.baseId !== 'string' || record.baseId.length === 0) return null;
    if (typeof record.relativePath !== 'string' || record.relativePath.length === 0) return null;
    if (typeof record.title !== 'string') return null;
    return {
      baseId: record.baseId,
      relativePath: record.relativePath,
      title: record.title,
      indexed: record.indexed === true,
      chunkCount: typeof record.chunkCount === 'number' ? record.chunkCount : 0,
      ...(typeof record.assistSessionId === 'string' && record.assistSessionId.length > 0
        ? { assistSessionId: record.assistSessionId }
        : {}),
    };
  } catch {
    return null;
  }
}

export function clearKnowledgeReaderReturn(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}
