import type { ContextPack, KnowledgePointType, RawKnowledgePoint } from '@piwin/contracts';

export const KNOWLEDGE_POINT_TYPES: readonly KnowledgePointType[] = [
  'definition',
  'fact',
  'property',
  'structure',
  'mechanism',
  'reason',
  'relationship',
  'comparison',
  'procedure',
  'application',
  'example',
  'exception',
  'formula',
];

export const RAW_KNOWLEDGE_POINT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['knowledgePoints'],
  properties: {
    knowledgePoints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tempId', 'concept', 'statement', 'type', 'importance', 'sourceChunkIds'],
        properties: {
          tempId: { type: 'string' },
          concept: { type: 'string' },
          statement: { type: 'string' },
          type: { type: 'string', enum: [...KNOWLEDGE_POINT_TYPES] },
          importance: { type: 'number' },
          sourceChunkIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const TYPE_SET = new Set<string>(KNOWLEDGE_POINT_TYPES);

export function parseRawKnowledgePoints(
  value: unknown,
  pack: ContextPack,
): RawKnowledgePoint[] {
  const record = asRecord(value);
  const list = record?.knowledgePoints ?? (Array.isArray(value) ? value : undefined);
  if (!Array.isArray(list)) return [];
  const allowed = new Set(pack.sources.map((source) => source.chunkId));
  const parsed: RawKnowledgePoint[] = [];
  for (const [index, item] of list.entries()) {
    const raw = asRecord(item);
    if (!raw) continue;
    const concept = typeof raw.concept === 'string' ? raw.concept.trim() : '';
    const statement = typeof raw.statement === 'string' ? raw.statement.trim() : '';
    if (!concept || !statement) continue;
    if (typeof raw.type !== 'string' || !TYPE_SET.has(raw.type)) continue;
    if (typeof raw.importance !== 'number' || !Number.isFinite(raw.importance)) continue;
    if (raw.importance < 0 || raw.importance > 1) continue;
    const sourceChunkIds = Array.isArray(raw.sourceChunkIds)
      ? raw.sourceChunkIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (sourceChunkIds.length === 0) continue;
    if (!sourceChunkIds.every((id) => allowed.has(id))) continue;
    parsed.push({
      tempId: typeof raw.tempId === 'string' && raw.tempId.trim() ? raw.tempId.trim() : `tmp_${index + 1}`,
      concept,
      statement,
      type: raw.type as KnowledgePointType,
      importance: raw.importance,
      sourceChunkIds,
    });
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
