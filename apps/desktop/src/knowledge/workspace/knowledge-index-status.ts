import type { KnowledgeBaseSummary } from '@piwin/contracts';

export type IndexStatusRow = {
  baseId: string;
  name: string;
  state: KnowledgeBaseSummary['state'];
  degraded: boolean;
  documentCount: number;
  failedDocumentCount: number;
  folderPath?: string;
  canRetry: boolean;
  canCancel: boolean;
};

export function indexStatusRows(bases: readonly KnowledgeBaseSummary[]): IndexStatusRow[] {
  return bases
    .filter((base) => base.kind === 'folder' || base.kind === 'wiki' || base.kind === 'notes')
    .map((base) => {
      const failed = base.failedDocumentCount ?? 0;
      const indexing = base.state === 'indexing';
      const needsWork =
        base.state === 'not-indexed' || base.state === 'partial' || failed > 0;
      const row: IndexStatusRow = {
        baseId: base.id,
        name: base.name,
        state: base.state,
        degraded: base.degraded,
        documentCount: base.documentCount,
        failedDocumentCount: failed,
        canRetry: Boolean(base.folderPath) && needsWork && !indexing,
        canCancel: Boolean(base.folderPath) && indexing,
      };
      if (base.folderPath) row.folderPath = base.folderPath;
      return row;
    });
}
