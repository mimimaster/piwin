import type { PiwinConfig } from '@piwin/contracts';

export type KnowledgeCapabilityId = 'mineru' | 'embedding' | 'reranker' | 'extractionLlm' | 'flashcardLlm';

export type KnowledgeCapabilityLight = {
  id: KnowledgeCapabilityId;
  configured: boolean;
};

export function knowledgeCapabilityLights(config: PiwinConfig | undefined): KnowledgeCapabilityLight[] {
  const knowledge = config?.knowledge;
  const defaultModel = Boolean(config?.defaultProviderId && config.defaultModelId);
  return [
    {
      id: 'mineru',
      configured: knowledge?.parser?.mineru?.enabled === true,
    },
    {
      id: 'embedding',
      configured: knowledge?.embedding?.enabled === true || Boolean(config?.notes?.embedding),
    },
    {
      id: 'reranker',
      configured: knowledge?.reranker?.enabled === true,
    },
    {
      id: 'extractionLlm',
      configured: Boolean(knowledge?.extractionLlm?.modelRef) || defaultModel,
    },
    {
      id: 'flashcardLlm',
      configured: Boolean(knowledge?.flashcardLlm?.modelRef) || defaultModel,
    },
  ];
}
