import type { DocumentManifest, GenerationJob, IngestionJob } from '@piwin/contracts';

export type DoccardsProgressView = {
  percent: number;
  labelEn: string;
  labelZh: string;
};

const GENERATION_STEPS: Array<{ status: GenerationJob['status']; weight: number; en: string; zh: string }> = [
  { status: 'CHECKING_INDEX', weight: 8, en: 'Checking index', zh: '检查索引' },
  { status: 'RETRIEVING', weight: 18, en: 'Retrieving', zh: '检索中' },
  { status: 'RERANKING', weight: 8, en: 'Reranking', zh: '重排中' },
  { status: 'ASSEMBLING_CONTEXT', weight: 8, en: 'Assembling context', zh: '组装上下文' },
  { status: 'EXTRACTING_KNOWLEDGE', weight: 18, en: 'Extracting', zh: '抽取知识点' },
  { status: 'PROCESSING_KNOWLEDGE', weight: 8, en: 'Processing', zh: '整理知识点' },
  { status: 'GENERATING_CARDS', weight: 18, en: 'Generating', zh: '生成卡片' },
  { status: 'VALIDATING', weight: 6, en: 'Validating', zh: '校验中' },
  { status: 'PERSISTING', weight: 8, en: 'Saving', zh: '保存中' },
  { status: 'OPENING_SESSION', weight: 8, en: 'Opening session', zh: '打开会话' },
];

const STAGE_LABEL: Record<keyof IngestionJob['stageCounts'], { en: string; zh: string }> = {
  parsing: { en: 'Parsing', zh: '解析中' },
  chunking: { en: 'Chunking', zh: '切块中' },
  embedding: { en: 'Embedding', zh: '向量化' },
  indexing: { en: 'Indexing', zh: '写入索引' },
};

export function selectedDocumentsReady(
  selected: string[],
  documents: DocumentManifest[],
): boolean {
  if (selected.length === 0) return false;
  const ready = new Set(
    documents.filter((document) => document.status === 'READY').map((document) => document.relativePath),
  );
  return selected.every((path) => ready.has(path));
}

export function ingestionProgress(job: IngestionJob): DoccardsProgressView {
  const total = Math.max(job.totalFiles, job.completedFiles, 1);
  const percent = job.status === 'COMPLETED' || job.status === 'COMPLETED_DEGRADED'
    ? 100
    : Math.min(99, Math.round((job.completedFiles / total) * 100));
  const stage = currentIngestionStage(job);
  const stageLabel = STAGE_LABEL[stage];
  return {
    percent,
    labelEn: `Indexing ${job.completedFiles}/${total} · ${stageLabel.en}`,
    labelZh: `入库 ${job.completedFiles}/${total} · ${stageLabel.zh}`,
  };
}

export function generationProgress(job: GenerationJob): DoccardsProgressView {
  if (job.status === 'COMPLETED' || job.status === 'COMPLETED_DEGRADED') {
    return { percent: 100, labelEn: 'Generated', labelZh: '已生成' };
  }
  const index = GENERATION_STEPS.findIndex((step) => step.status === job.status);
  const reached = index < 0 ? 0 : GENERATION_STEPS.slice(0, index).reduce((sum, step) => sum + step.weight, 0);
  const current = GENERATION_STEPS[index] ?? GENERATION_STEPS[0];
  return {
    percent: Math.min(99, reached + Math.floor((current?.weight ?? 8) / 2)),
    labelEn: current?.en ?? 'Generating',
    labelZh: current?.zh ?? '生成中',
  };
}

function currentIngestionStage(job: IngestionJob): keyof IngestionJob['stageCounts'] {
  const order: Array<keyof IngestionJob['stageCounts']> = ['indexing', 'embedding', 'chunking', 'parsing'];
  for (const stage of order) {
    if ((job.stageCounts[stage] ?? 0) > 0) return stage;
  }
  return 'parsing';
}
