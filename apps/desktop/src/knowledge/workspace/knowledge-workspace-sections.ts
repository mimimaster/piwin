/**
 * Knowledge workspace navigation model.
 *
 * Pure data: the section order, labels and the legacy-entry mapping live here
 * so the shell component stays layout-only and the mapping is unit tested
 * instead of being re-derived inline.
 */

/** Fixed top-level sections. Order is the navigation order. */
export type KnowledgeWorkspaceSection = 'overview' | 'materials' | 'wiki' | 'flashcards';

export type KnowledgeSectionMeta = {
  section: KnowledgeWorkspaceSection;
  labelEn: string;
  labelZh: string;
  testId: string;
};

export const KNOWLEDGE_WORKSPACE_SECTIONS: readonly KnowledgeSectionMeta[] = [
  {
    section: 'overview',
    labelEn: 'Overview',
    labelZh: '总览',
    testId: 'knowledge-section-overview',
  },
  {
    section: 'materials',
    labelEn: 'Materials',
    labelZh: '资料库',
    testId: 'knowledge-section-materials',
  },
  {
    section: 'wiki',
    labelEn: 'Knowledge Wiki',
    labelZh: '知识 Wiki',
    testId: 'knowledge-section-wiki',
  },
  {
    section: 'flashcards',
    labelEn: 'Flashcards & Study',
    labelZh: '闪卡复习',
    testId: 'knowledge-section-flashcards',
  },
];

/** Every entry point the Desktop still sends; `overview` is the plain entry. */
export type KnowledgeLegacyEntry = 'overview' | 'wiki' | 'documents' | 'flashcards';

/**
 * Old entries keep working:
 * - `documents` used to mean "wiki with the source drawer open", so it now
 *   lands on the materials library it was actually trying to reach.
 * - An explicit folder path (produce-for-this-folder) also means materials.
 * - Anything else without a section opens the overview.
 */
export function resolveKnowledgeSection(input: {
  initialTab?: KnowledgeLegacyEntry | undefined;
  initialFolderPath?: string | undefined;
}): KnowledgeWorkspaceSection {
  if (input.initialFolderPath && input.initialFolderPath.trim().length > 0) return 'materials';
  switch (input.initialTab) {
    case 'flashcards':
      return 'flashcards';
    case 'documents':
      return 'materials';
    case 'wiki':
      return 'wiki';
    case 'overview':
    case undefined:
      return 'overview';
  }
}

export function knowledgeSectionMeta(section: KnowledgeWorkspaceSection): KnowledgeSectionMeta {
  const meta = KNOWLEDGE_WORKSPACE_SECTIONS.find((entry) => entry.section === section);
  if (!meta) throw new Error(`Unknown knowledge section: ${String(section)}`);
  return meta;
}
