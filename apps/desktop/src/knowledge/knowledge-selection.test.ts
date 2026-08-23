import { describe, expect, it } from 'vitest';
import type { DocumentManifest, ScannedDocFile } from '@piwin/contracts';
import {
  defaultSelectedSupportedPaths,
  deriveProjectIndexStatus,
  formatIndexCapHint,
  formatIngestionWarnings,
} from './knowledge-selection.js';

function file(relativePath: string, sizeBytes = 10): ScannedDocFile {
  return { relativePath, sizeBytes, language: 'markdown' };
}

function doc(relativePath: string, status: DocumentManifest['status'] = 'READY'): DocumentManifest {
  return {
    documentId: relativePath,
    folderKey: 'fk',
    relativePath,
    extension: '.md',
    fileSize: 10,
    fileHash: relativePath,
    status,
  };
}

describe('defaultSelectedSupportedPaths', () => {
  it('prefers already-READY documents when any exist', () => {
    const files = [file('a.md'), file('b.md'), file('c.md')];
    const documents = [doc('a.md'), doc('c.md')];
    expect(defaultSelectedSupportedPaths(files, documents, 2000)).toEqual(['a.md', 'c.md']);
  });

  it('caps fresh selection at max files when nothing is indexed yet', () => {
    const files = [file('a.md'), file('b.md'), file('c.md'), file('d.md')];
    expect(defaultSelectedSupportedPaths(files, [], 2)).toEqual(['a.md', 'b.md']);
  });

  it('ignores READY paths that are no longer in the scan', () => {
    const files = [file('a.md')];
    const documents = [doc('a.md'), doc('gone.md')];
    expect(defaultSelectedSupportedPaths(files, documents, 2000)).toEqual(['a.md']);
  });
});

describe('deriveProjectIndexStatus', () => {
  it('keeps indexing while the loop stage is indexing', () => {
    expect(
      deriveProjectIndexStatus({ stage: 'indexing', readyCount: 10, scannedCount: 100 }),
    ).toBe('indexing');
  });

  it('reports ready when some documents are already indexed', () => {
    expect(
      deriveProjectIndexStatus({ stage: 'select-files', readyCount: 2000, scannedCount: 2772 }),
    ).toBe('ready');
  });

  it('reports unindexed when nothing is ready and not indexing', () => {
    expect(
      deriveProjectIndexStatus({ stage: 'select-files', readyCount: 0, scannedCount: 50 }),
    ).toBe('unindexed');
  });
});

describe('formatIndexCapHint', () => {
  it('explains the ingest file cap in Chinese when scan exceeds the limit', () => {
    expect(formatIndexCapHint(2772, 2000, 'zh-CN')).toContain('2000');
    expect(formatIndexCapHint(2772, 2000, 'zh-CN')).toContain('2772');
  });

  it('returns null when under the cap', () => {
    expect(formatIndexCapHint(10, 2000, 'zh-CN')).toBeNull();
  });
});

describe('formatIngestionWarnings', () => {
  it('joins job warning messages for display', () => {
    expect(
      formatIngestionWarnings([
        { file: '', code: 'INDEX_WARNING', message: 'Reached max files (2000); stopping.' },
        { file: 'big.md', code: 'INDEX_WARNING', message: 'Skipped (too large): big.md' },
      ]),
    ).toContain('Reached max files (2000)');
  });
});
