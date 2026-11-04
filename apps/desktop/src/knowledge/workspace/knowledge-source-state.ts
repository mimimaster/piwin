/**
 * One label for one source state, shared by the materials list and the library
 * chips. Two surfaces reading the same state must not describe it differently
 * ("未入库" beside "可读 · 尚未索引" was exactly that bug).
 */
import type { KnowledgeBaseSummary } from '@piwin/contracts';

export type KnowledgeStateTone = 'ok' | 'warn' | 'bad' | 'muted';

export function knowledgeBaseStateLabel(
  base: KnowledgeBaseSummary,
  t: (en: string, zh: string) => string,
): { label: string; tone: KnowledgeStateTone } {
  switch (base.state) {
    case 'ready':
      return base.degraded
        ? { label: t('Full-text search', '全文可搜'), tone: 'ok' }
        : { label: t('Searchable', '可搜'), tone: 'ok' };
    case 'partial':
      return { label: t('Partly indexed', '部分索引失败'), tone: 'warn' };
    case 'indexing':
      return { label: t('Indexing', '索引中'), tone: 'warn' };
    case 'missing':
      return { label: t('Source missing', '来源已丢失'), tone: 'bad' };
    case 'empty':
      return { label: t('Empty', '空'), tone: 'muted' };
    case 'not-indexed':
    default:
      // Registered and readable, just not searchable yet.
      return { label: t('Readable · not indexed', '可读 · 尚未索引'), tone: 'muted' };
  }
}
