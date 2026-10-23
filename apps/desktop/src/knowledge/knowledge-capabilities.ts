import type { PiwinConfig } from '@piwin/contracts';

export type KnowledgeCapabilityId = 'mineru' | 'embedding' | 'reranker' | 'extractionLlm' | 'flashcardLlm';

export type KnowledgeCapabilityLight = {
  id: KnowledgeCapabilityId;
  configured: boolean;
  labelEn: string;
  labelZh: string;
  descEn: string;
  descZh: string;
  optional: boolean;
};

export const KNOWLEDGE_CAPABILITY_METAS: Record<
  KnowledgeCapabilityId,
  { labelEn: string; labelZh: string; descEn: string; descZh: string; optional: boolean }
> = {
  mineru: {
    labelEn: 'PDF Parser (MinerU)',
    labelZh: 'PDF 解析 (MinerU)',
    descEn: 'High-precision document and formula extraction',
    descZh: '复杂版面与公式的高精度文档解析',
    optional: true,
  },
  embedding: {
    labelEn: 'Embedding',
    labelZh: '向量检索 (Embedding)',
    descEn: 'Semantic vector search (falls back to full-text search if disabled)',
    descZh: '语义向量检索（未启用时降级为全文检索）',
    optional: true,
  },
  reranker: {
    labelEn: 'Reranker',
    labelZh: '精准重排 (Reranker)',
    descEn: 'Cross-encoder ranking for higher retrieval precision',
    descZh: '二次重排模型，提升检索准确率',
    optional: true,
  },
  extractionLlm: {
    labelEn: 'Extraction Model',
    labelZh: '知识抽取模型',
    descEn: 'LLM for extracting key concepts and knowledge units',
    descZh: '提炼核心概念与知识要点的模型',
    optional: false,
  },
  flashcardLlm: {
    labelEn: 'Flashcard Model',
    labelZh: '闪卡生成模型',
    descEn: 'LLM for authoring high-quality spaced repetition cards',
    descZh: '制作高质量间隔重复记忆闪卡',
    optional: false,
  },
};

export function knowledgeCapabilityLights(config: PiwinConfig | undefined): KnowledgeCapabilityLight[] {
  const knowledge = config?.knowledge;
  const defaultModel = Boolean(config?.defaultProviderId && config.defaultModelId);
  return [
    {
      id: 'mineru',
      configured: knowledge?.parser?.mineru?.enabled === true,
      ...KNOWLEDGE_CAPABILITY_METAS.mineru,
    },
    {
      id: 'embedding',
      configured: knowledge?.embedding?.enabled === true || Boolean(config?.notes?.embedding),
      ...KNOWLEDGE_CAPABILITY_METAS.embedding,
    },
    {
      id: 'reranker',
      configured: knowledge?.reranker?.enabled === true,
      ...KNOWLEDGE_CAPABILITY_METAS.reranker,
    },
    {
      id: 'extractionLlm',
      configured: Boolean(knowledge?.extractionLlm?.modelRef) || defaultModel,
      ...KNOWLEDGE_CAPABILITY_METAS.extractionLlm,
    },
    {
      id: 'flashcardLlm',
      configured: Boolean(knowledge?.flashcardLlm?.modelRef) || defaultModel,
      ...KNOWLEDGE_CAPABILITY_METAS.flashcardLlm,
    },
  ];
}
