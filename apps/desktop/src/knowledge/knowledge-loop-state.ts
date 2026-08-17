import type { DocumentManifest, GenerationJob, IngestionJob } from '@piwin/contracts';
import { selectedDocumentsReady } from '../doccards-progress.js';

export type KnowledgeLoopStage =
  | 'pick-folder'
  | 'select-files'
  | 'indexing'
  | 'ready'
  | 'generating'
  | 'result'
  | 'library';

export type GenerateBlockReason =
  | 'no-folder'
  | 'no-supported-selected'
  | 'indexing'
  | 'generating'
  | 'selected-not-ready'
  | null;

export type KnowledgeLoopInput = {
  folderPath: string | null;
  selectedSupported: string[];
  documents: DocumentManifest[];
  indexJob: IngestionJob | null;
  generationJob: GenerationJob | null;
  userView: 'loop' | 'library';
  dismissedGenerationId: string | null;
};

export type KnowledgeLoopView = {
  stage: KnowledgeLoopStage;
  primary: 'pick-folder' | 'index' | 'generate' | 'open-review' | null;
  generateEnabled: boolean;
  generateBlockReason: GenerateBlockReason;
  indexEnabled: boolean;
  reindexEnabled: boolean;
  showOpenReview: boolean;
  resultKind: 'none' | 'created' | 'zero' | 'degraded' | 'failed' | 'canceled';
};

const INDEX_RUNNING: ReadonlySet<IngestionJob['status']> = new Set(['PENDING', 'RUNNING']);
const GENERATION_TERMINAL: ReadonlySet<GenerationJob['status']> = new Set([
  'COMPLETED',
  'COMPLETED_DEGRADED',
  'FAILED',
  'CANCELED',
]);

function isGenerationRunning(job: GenerationJob | null): boolean {
  return job !== null && !GENERATION_TERMINAL.has(job.status);
}

function createdCount(job: GenerationJob): number {
  return job.created ?? job.createdCardIds?.length ?? 0;
}

function resultKindOf(job: GenerationJob): KnowledgeLoopView['resultKind'] {
  if (job.status === 'FAILED') return 'failed';
  if (job.status === 'CANCELED') return 'canceled';
  if (job.status === 'COMPLETED_DEGRADED' && createdCount(job) > 0) return 'degraded';
  if (job.status === 'COMPLETED' && createdCount(job) === 0) return 'zero';
  if (job.status === 'COMPLETED' && createdCount(job) > 0 && job.sessionId) return 'created';
  if (job.status === 'COMPLETED' && createdCount(job) > 0) return 'degraded';
  return 'none';
}

export function deriveKnowledgeLoop(input: KnowledgeLoopInput): KnowledgeLoopView {
  const selectedReady = selectedDocumentsReady(input.selectedSupported, input.documents);
  const hasFolder = Boolean(input.folderPath);
  const indexRunning = Boolean(input.indexJob && INDEX_RUNNING.has(input.indexJob.status));
  const genRunning = isGenerationRunning(input.generationJob);
  const terminalGen =
    input.generationJob &&
    GENERATION_TERMINAL.has(input.generationJob.status) &&
    input.generationJob.id !== input.dismissedGenerationId
      ? input.generationJob
      : null;

  const reindexEnabled = hasFolder && !indexRunning && !genRunning;
  const indexEnabled = hasFolder && !indexRunning && !genRunning && input.selectedSupported.length > 0;

  let generateBlockReason: GenerateBlockReason = null;
  if (!hasFolder) generateBlockReason = 'no-folder';
  else if (input.selectedSupported.length === 0) generateBlockReason = 'no-supported-selected';
  else if (indexRunning) generateBlockReason = 'indexing';
  else if (genRunning) generateBlockReason = 'generating';
  else if (!selectedReady) generateBlockReason = 'selected-not-ready';

  const generateEnabled = generateBlockReason === null;

  if (!hasFolder) {
    return {
      stage: 'pick-folder',
      primary: 'pick-folder',
      generateEnabled,
      generateBlockReason,
      indexEnabled: false,
      reindexEnabled: false,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  if (input.userView === 'library') {
    return {
      stage: 'library',
      primary: null,
      generateEnabled,
      generateBlockReason,
      indexEnabled,
      reindexEnabled,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  if (indexRunning) {
    return {
      stage: 'indexing',
      primary: null,
      generateEnabled,
      generateBlockReason,
      indexEnabled: false,
      reindexEnabled: false,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  if (genRunning) {
    return {
      stage: 'generating',
      primary: null,
      generateEnabled,
      generateBlockReason,
      indexEnabled: false,
      reindexEnabled: false,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  if (terminalGen) {
    const resultKind = resultKindOf(terminalGen);
    const showOpenReview = resultKind === 'created';
    return {
      stage: 'result',
      primary: showOpenReview ? 'open-review' : null,
      generateEnabled,
      generateBlockReason,
      indexEnabled,
      reindexEnabled,
      showOpenReview,
      resultKind,
    };
  }

  if (selectedReady) {
    return {
      stage: 'ready',
      primary: 'generate',
      generateEnabled,
      generateBlockReason,
      indexEnabled,
      reindexEnabled,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  return {
    stage: 'select-files',
    primary: indexEnabled ? 'index' : null,
    generateEnabled,
    generateBlockReason,
    indexEnabled,
    reindexEnabled,
    showOpenReview: false,
    resultKind: 'none',
  };
}

const COPY: Record<Exclude<GenerateBlockReason, null>, { en: string; zh: string }> = {
  indexing: { en: 'Indexing…', zh: '正在入库…' },
  generating: { en: 'Generating cards…', zh: '正在生成闪卡…' },
  'no-supported-selected': {
    en: 'Select at least one supported file',
    zh: '请至少选择一个支持的文件',
  },
  'selected-not-ready': { en: 'Index the selected files first', zh: '请先入库所选文件' },
  'no-folder': { en: 'Choose a folder first', zh: '请先选择文件夹' },
};

export function generateDisabledCopy(
  reason: GenerateBlockReason,
  extras: { mineruMissing?: boolean },
  locale: 'zh-CN' | 'en',
): string | null {
  if (reason) {
    const pair = COPY[reason];
    return locale === 'zh-CN' ? pair.zh : pair.en;
  }
  if (extras.mineruMissing) {
    return locale === 'zh-CN'
      ? 'PDF 需要在知识设置里启用 MinerU'
      : 'PDF needs MinerU in Knowledge settings';
  }
  return null;
}
