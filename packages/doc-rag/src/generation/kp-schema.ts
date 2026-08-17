import type { ContextPack, KnowledgePointType, RawKnowledgePoint } from '@piwin/contracts';
import { fallbackPackSourceId, resolveSourceIds } from './resolve-source-ids.js';

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
    const type = coerceKnowledgePointType(raw.type);
    if (!type) continue;
    const importance = coerceImportance(raw.importance);
    if (importance === undefined) continue;
    const rawSourceIds = Array.isArray(raw.sourceChunkIds)
      ? raw.sourceChunkIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const sourceChunkIds = resolveSourceIds(rawSourceIds, pack).filter((id) => allowed.has(id));
    const fallback = fallbackPackSourceId(pack);
    if (sourceChunkIds.length === 0 && fallback && allowed.has(fallback)) {
      sourceChunkIds.push(fallback);
    }
    if (sourceChunkIds.length === 0) continue;
    parsed.push({
      tempId: typeof raw.tempId === 'string' && raw.tempId.trim() ? raw.tempId.trim() : `tmp_${index + 1}`,
      concept,
      statement,
      type,
      importance,
      sourceChunkIds,
    });
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

const IMPORTANCE_LABELS: Record<string, number> = {
  high: 0.9,
  medium: 0.7,
  med: 0.7,
  mid: 0.7,
  low: 0.55,
  critical: 1,
  important: 0.85,
};

function coerceImportance(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) return value;
    if (value >= 2 && value <= 10) return value / 10;
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (IMPORTANCE_LABELS[trimmed] !== undefined) return IMPORTANCE_LABELS[trimmed];
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return coerceImportance(numeric);
  }
  return undefined;
}

const TYPE_ALIASES: Record<string, KnowledgePointType> = {
  principle: 'reason',
  rule: 'property',
  concept: 'definition',
  idea: 'definition',
  process: 'procedure',
  step: 'procedure',
  why: 'reason',
  how: 'procedure',
  cause: 'reason',
  effect: 'relationship',
  note: 'fact',
};

function coerceKnowledgePointType(value: unknown): KnowledgePointType | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (TYPE_SET.has(trimmed)) return trimmed as KnowledgePointType;
  const aliased = TYPE_ALIASES[trimmed.toLowerCase()];
  if (aliased) return aliased;
  return 'fact';
}
