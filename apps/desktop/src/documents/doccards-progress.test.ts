import { describe, expect, it } from 'vitest';
import type { DocumentManifest, IngestionJob } from '@piwin/contracts';
import { generationProgress, ingestionProgress, selectedDocumentsReady } from './doccards-progress';

function ingest(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    id: 'ing_1',
    folderKey: 'fk',
    workspaceName: 'Notes',
    folderPath: '/docs/Notes',
    includeFiles: ['a.md'],
    status: 'RUNNING',
    totalFiles: 8,
    completedFiles: 2,
    failedFiles: 0,
    skippedUnsupported: 0,
    stageCounts: { parsing: 2, chunking: 1, embedding: 0, indexing: 0 },
    warnings: [],
    ...overrides,
  };
}

describe('doccards progress', () => {
  it('shows an index percent and the latest stage', () => {
    const view = ingestionProgress(ingest());
    expect(view.percent).toBe(25);
    expect(view.labelEn).toContain('2/8');
    expect(view.labelEn).toContain('Chunking');
  });

  it('advances generate percent by stage', () => {
    const retrieving = generationProgress({
      id: 'gen_1',
      folderKey: 'fk',
      folderPath: '/docs',
      workspaceName: 'Notes',
      includeFiles: ['a.md'],
      status: 'RETRIEVING',
    });
    const saving = generationProgress({
      id: 'gen_1',
      folderKey: 'fk',
      folderPath: '/docs',
      workspaceName: 'Notes',
      includeFiles: ['a.md'],
      status: 'PERSISTING',
    });
    expect(retrieving.percent).toBeGreaterThan(0);
    expect(saving.percent).toBeGreaterThan(retrieving.percent);
    expect(saving.labelEn).toBe('Saving');
  });

  it('treats selected files as ready only when every one is READY', () => {
    const documents: DocumentManifest[] = [
      {
        documentId: '1',
        folderKey: 'fk',
        relativePath: 'a.md',
        extension: '.md',
        fileSize: 1,
        fileHash: 'a',
        status: 'READY',
      },
      {
        documentId: '2',
        folderKey: 'fk',
        relativePath: 'b.md',
        extension: '.md',
        fileSize: 1,
        fileHash: 'b',
        status: 'FAILED',
      },
    ];
    expect(selectedDocumentsReady(['a.md'], documents)).toBe(true);
    expect(selectedDocumentsReady(['a.md', 'b.md'], documents)).toBe(false);
    expect(selectedDocumentsReady([], documents)).toBe(false);
  });
});
