import { describe, expect, it } from 'vitest';
import type { KnowledgeBaseSummary } from '@piwin/contracts';
import { indexStatusRows } from './knowledge-index-status.js';

const base = (partial: Partial<KnowledgeBaseSummary> & Pick<KnowledgeBaseSummary, 'id' | 'name' | 'state'>): KnowledgeBaseSummary => ({
  kind: 'folder',
  degraded: false,
  documentCount: 0,
  folderPath: '/docs/a',
  ...partial,
});

describe('indexStatusRows', () => {
  it('lets a partial folder retry and an indexing folder cancel', () => {
    const rows = indexStatusRows([
      base({ id: 'folder:a', name: 'A', state: 'partial', failedDocumentCount: 2, documentCount: 10 }),
      base({ id: 'folder:b', name: 'B', state: 'indexing', documentCount: 3 }),
      base({ id: 'folder:c', name: 'C', state: 'ready', documentCount: 4 }),
    ]);
    expect(rows[0]).toMatchObject({ canRetry: true, canCancel: false, failedDocumentCount: 2 });
    expect(rows[1]).toMatchObject({ canRetry: false, canCancel: true });
    expect(rows[2]).toMatchObject({ canRetry: false, canCancel: false });
  });
});
