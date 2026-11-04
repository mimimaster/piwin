/**
 * Knowledge workspace identity and collections (knowledge product integration,
 * stage 0 protocol).
 *
 * Identity is deliberately separate from the display title: one material keeps
 * one identity no matter how many collections, citations or readings point at
 * it, so a card never gets duplicated and an FSRS review record never resets
 * because the same source was reachable from two places.
 *
 * Stage 0 freezes this shape before any writer exists. Collections are
 * read-only today; material membership is added with the materials library.
 * See `docs/adr/0103-knowledge-workspace-integration.md`.
 */

/**
 * Identity of one knowledge item.
 *
 * `wiki` uses the concept's relative path because that is the only durable
 * identity the wiki store has today; a stable page id replaces it together
 * with the wiki revision work, and the ADR records that migration.
 */
export type KnowledgeContentId =
  | { kind: 'notes'; noteId: string }
  | { kind: 'material'; baseId: string; relativePath: string }
  | { kind: 'wiki'; relativePath: string }
  | { kind: 'card'; itemId: string };

export type KnowledgeContentKind = KnowledgeContentId['kind'];

/**
 * Per-kind member counts. A content item that belongs to several collections
 * is counted once per collection and never duplicated in storage.
 */
export type KnowledgeCollectionCounts = {
  notes: number;
  materials: number;
  wiki: number;
  cards: number;
};

/**
 * A user-defined topic collection. `counts` are derived from membership on
 * read, not persisted, so a stale count can never outlive the membership.
 */
export type KnowledgeCollection = {
  id: string;
  name: string;
  counts: KnowledgeCollectionCounts;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeCollectionListResult = {
  collections: KnowledgeCollection[];
};

/** Read-only listing; creation and membership land with the materials library. */
export type KnowledgeWorkspaceHostCommand = {
  id?: string;
  type: 'knowledge/collections/list';
};

/**
 * Old Hosts omit this flag. Clients keep the sections those Hosts do support
 * (wiki, flashcards) and show an upgrade hint only for the missing ones.
 */
export function hostSupportsKnowledgeWorkspace(
  capabilities: { knowledgeWorkspace?: boolean } | undefined,
): boolean {
  return capabilities?.knowledgeWorkspace === true;
}

export function knowledgeContentKindOf(id: KnowledgeContentId): KnowledgeContentKind {
  return id.kind;
}
