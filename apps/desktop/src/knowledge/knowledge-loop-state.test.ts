import { describe, expect, it } from 'vitest';
import type { DocumentManifest, GenerationJob, IngestionJob } from '@piwin/contracts';
import {
  deriveKnowledgeLoop,
  generateDisabledCopy,
  type KnowledgeLoopInput,
} from './knowledge-loop-state.js';

function document(relativePath: string, status: DocumentManifest['status'] = 'READY'): DocumentManifest {
  return {
    documentId: relativePath,
    folderKey: 'fk',
    relativePath,
    extension: '.md',
    fileSize: 1,
    fileHash: relativePath,
    status,
  };
}

function indexJob(status: IngestionJob['status']): IngestionJob {
  return {
    id: 'ing_1',
    folderKey: 'fk',
    workspaceName: 'Notes',
    folderPath: '/docs/Notes',
    includeFiles: ['a.md'],
    status,
    totalFiles: 1,
    completedFiles: status === 'COMPLETED' ? 1 : 0,
    failedFiles: 0,
    skippedUnsupported: 0,
    stageCounts: { parsing: 0, chunking: 0, embedding: 0, indexing: 0 },
    warnings: [],
  };
}

function generationJob(
  status: GenerationJob['status'],
  extra: Partial<GenerationJob> = {},
): GenerationJob {
  return {
    id: extra.id ?? 'gen_1',
    folderKey: 'fk',
    folderPath: '/docs/Notes',
    workspaceName: 'Notes',
    includeFiles: ['a.md'],
    status,
    ...extra,
  };
}

function input(overrides: Partial<KnowledgeLoopInput> = {}): KnowledgeLoopInput {
  return {
    folderPath: '/docs/Notes',
    selectedSupported: ['a.md'],
    documents: [document('a.md')],
    indexJob: indexJob('COMPLETED'),
    generationJob: null,
    userView: 'loop',
    dismissedGenerationId: null,
    ...overrides,
  };
}

describe('deriveKnowledgeLoop priority', () => {
  it('1. empty folderPath → pick-folder', () => {
    const view = deriveKnowledgeLoop(input({ folderPath: null, selectedSupported: [], documents: [] }));
    expect(view.stage).toBe('pick-folder');
    expect(view.primary).toBe('pick-folder');
    expect(view.generateEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('no-folder');
    expect(view.indexEnabled).toBe(false);
    expect(view.reindexEnabled).toBe(false);
  });

  it('2. userView library wins over ready jobs', () => {
    const view = deriveKnowledgeLoop(input({ userView: 'library' }));
    expect(view.stage).toBe('library');
    expect(view.primary).toBeNull();
  });

  it('3. ingestion PENDING or RUNNING → indexing (beats generate)', () => {
    const view = deriveKnowledgeLoop(
      input({
        indexJob: indexJob('RUNNING'),
        generationJob: generationJob('RETRIEVING'),
      }),
    );
    expect(view.stage).toBe('indexing');
    expect(view.primary).toBeNull();
    expect(view.generateEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('indexing');
    expect(view.indexEnabled).toBe(false);
    expect(view.reindexEnabled).toBe(false);
  });

  it('4. generation non-terminal → generating', () => {
    const view = deriveKnowledgeLoop(input({ generationJob: generationJob('GENERATING_CARDS') }));
    expect(view.stage).toBe('generating');
    expect(view.generateEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('generating');
    expect(view.reindexEnabled).toBe(false);
  });

  it('5. terminal generation not dismissed → result', () => {
    const view = deriveKnowledgeLoop(
      input({
        generationJob: generationJob('COMPLETED', {
          created: 2,
          createdCardIds: ['c1', 'c2'],
          sessionId: 'sess-1',
        }),
      }),
    );
    expect(view.stage).toBe('result');
    expect(view.resultKind).toBe('created');
    expect(view.primary).toBe('open-review');
    expect(view.showOpenReview).toBe(true);
  });

  it('dismissed generation id returns to ready', () => {
    const view = deriveKnowledgeLoop(
      input({
        generationJob: generationJob('COMPLETED', {
          id: 'gen_9',
          created: 2,
          sessionId: 'sess-1',
        }),
        dismissedGenerationId: 'gen_9',
      }),
    );
    expect(view.stage).toBe('ready');
    expect(view.resultKind).toBe('none');
    expect(view.primary).toBe('generate');
  });

  it('6. selected supported all READY → ready', () => {
    const view = deriveKnowledgeLoop(input());
    expect(view.stage).toBe('ready');
    expect(view.primary).toBe('generate');
    expect(view.generateEnabled).toBe(true);
    expect(view.generateBlockReason).toBeNull();
    expect(view.indexEnabled).toBe(true);
    expect(view.reindexEnabled).toBe(true);
  });

  it('7. folder selected but not ready → select-files', () => {
    const view = deriveKnowledgeLoop(
      input({
        documents: [document('a.md', 'DISCOVERED')],
        indexJob: null,
      }),
    );
    expect(view.stage).toBe('select-files');
    expect(view.primary).toBe('index');
    expect(view.indexEnabled).toBe(true);
    expect(view.generateEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('selected-not-ready');
  });

  it('no supported selected → select-files and cannot index', () => {
    const view = deriveKnowledgeLoop(input({ selectedSupported: [], documents: [] }));
    expect(view.stage).toBe('select-files');
    expect(view.indexEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('no-supported-selected');
  });
});

describe('resultKind', () => {
  it('created=0 is zero, no open-review', () => {
    const view = deriveKnowledgeLoop(
      input({ generationJob: generationJob('COMPLETED', { created: 0, createdCardIds: [] }) }),
    );
    expect(view.stage).toBe('result');
    expect(view.resultKind).toBe('zero');
    expect(view.primary).toBeNull();
    expect(view.showOpenReview).toBe(false);
  });

  it('COMPLETED_DEGRADED with cards is degraded, no auto open-review primary', () => {
    const view = deriveKnowledgeLoop(
      input({
        generationJob: generationJob('COMPLETED_DEGRADED', {
          created: 3,
          createdCardIds: ['a', 'b', 'c'],
        }),
      }),
    );
    expect(view.resultKind).toBe('degraded');
    expect(view.primary).toBeNull();
    expect(view.showOpenReview).toBe(false);
  });

  it('FAILED and CANCELED have no open-review', () => {
    expect(deriveKnowledgeLoop(input({ generationJob: generationJob('FAILED') })).resultKind).toBe(
      'failed',
    );
    expect(deriveKnowledgeLoop(input({ generationJob: generationJob('CANCELED') })).resultKind).toBe(
      'canceled',
    );
    expect(deriveKnowledgeLoop(input({ generationJob: generationJob('FAILED') })).showOpenReview).toBe(
      false,
    );
  });

  it('KnowledgeLoopView has no showBrowseLibrary field', () => {
    const view = deriveKnowledgeLoop(input());
    expect('showBrowseLibrary' in view).toBe(false);
  });
});

describe('generateDisabledCopy', () => {
  it('returns zh and en for each reason', () => {
    expect(generateDisabledCopy('indexing', {}, 'zh-CN')).toBe('正在入库…');
    expect(generateDisabledCopy('indexing', {}, 'en')).toBe('Indexing…');
    expect(generateDisabledCopy('generating', {}, 'zh-CN')).toBe('正在生成闪卡…');
    expect(generateDisabledCopy('no-supported-selected', {}, 'en')).toBe(
      'Select at least one supported file',
    );
    expect(generateDisabledCopy('selected-not-ready', {}, 'zh-CN')).toBe('请先入库所选文件');
    expect(generateDisabledCopy('no-folder', {}, 'zh-CN')).toBe('请先选择文件夹');
    expect(generateDisabledCopy(null, { mineruMissing: true }, 'zh-CN')).toBe(
      'PDF 需要在知识设置里启用 MinerU',
    );
    expect(generateDisabledCopy(null, {}, 'en')).toBeNull();
  });
});
