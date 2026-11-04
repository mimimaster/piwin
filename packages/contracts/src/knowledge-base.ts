/**
 * Unified knowledge base (docs/specs/2026-09-11-unified-knowledge-base.md).
 *
 * One user-facing "knowledge base" concept over two engines: the built-in
 * notes library (`@piwin/notes`) and user folders indexed by `@piwin/doc-rag`.
 * The Host owns the registry; clients never keep their own folder list.
 */
import type { KnowledgeWorkspaceHostCommand } from './knowledge-workspace.js';
import type {
  KnowledgeDocumentListCommand,
  KnowledgeDocumentReadCommand,
} from './knowledge-library.js';

export type KnowledgeBaseKind = 'notes' | 'folder' | 'wiki';

/**
 * Derived at read time, never persisted in the registry.
 * - notes: `empty` | `ready`
 * - folder: `missing` | `not-indexed` | `indexing` | `ready` | `partial`
 * - wiki: `empty` | `ready`
 */
export type KnowledgeBaseState =
  | 'empty'
  | 'missing'
  | 'not-indexed'
  | 'indexing'
  | 'ready'
  | 'partial';

/** The built-in notes library always uses this id. */
export const NOTES_KNOWLEDGE_BASE_ID = 'notes';

/** The built-in wiki knowledge base always uses this id. */
export const WIKI_KNOWLEDGE_BASE_ID = 'wiki';

const FOLDER_ID_PREFIX = 'folder:';
const FOLDER_KEY_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Folder base ids reuse doc-rag's `folderKey` so a lost registry can be
 * rebuilt from `~/.piwin/doc-rag/<folderKey>/.source-path` sidecars.
 */
export function folderKnowledgeBaseId(folderKey: string): string {
  return `${FOLDER_ID_PREFIX}${folderKey}`;
}

export type ParsedKnowledgeBaseId =
  | { kind: 'notes' }
  | { kind: 'wiki' }
  | { kind: 'folder'; folderKey: string };

export function parseKnowledgeBaseId(id: string): ParsedKnowledgeBaseId | null {
  if (id === NOTES_KNOWLEDGE_BASE_ID) {
    return { kind: 'notes' };
  }
  if (id === WIKI_KNOWLEDGE_BASE_ID) {
    return { kind: 'wiki' };
  }
  if (!id.startsWith(FOLDER_ID_PREFIX)) {
    return null;
  }
  const folderKey = id.slice(FOLDER_ID_PREFIX.length);
  return FOLDER_KEY_PATTERN.test(folderKey) ? { kind: 'folder', folderKey } : null;
}

export type KnowledgeBaseSummary = {
  id: string;
  kind: KnowledgeBaseKind;
  name: string;
  /** Canonical absolute Host path. Folder bases only. */
  folderPath?: string;
  state: KnowledgeBaseState;
  /** No embedding provider: retrieval runs full-text only. */
  degraded: boolean;
  /** Note count, or READY document count for folders. */
  documentCount: number;
  /** Folder bases: documents whose last ingestion FAILED. */
  failedDocumentCount?: number;
  chunkCount?: number;
  lastIndexedAt?: string;
  lastUsedAt?: string;
  createdAt?: string;
};

/** One retrieved passage, addressable by the `[ref]` marker the model writes. */
export type KnowledgeCitation = {
  /**
   * 1-based marker. Unique across every knowledge tool result within one
   * session run, so `[n]` in the assistant reply resolves to exactly one
   * citation. `knowledge/search` numbers from 1 per call.
   */
  ref: number;
  baseId: string;
  baseName: string;
  kind: KnowledgeBaseKind;
  /** Note title, or the folder-relative path. */
  title: string;
  noteId?: string;
  relativePath?: string;
  headingPath?: string[];
  startLine?: number;
  endLine?: number;
  pageStart?: number;
  pageEnd?: number;
  text: string;
  score?: number;
  /**
   * Frontmatter fields parsed off the source document (notes always carry
   * `title`/`tags`; sources without frontmatter omit this entirely).
   */
  metadata?: Record<string, unknown>;
};

export type KnowledgeSearchSkipReason = 'unknown' | 'missing' | 'not-indexed' | 'indexing' | 'error';

export type KnowledgeSearchResult = {
  citations: KnowledgeCitation[];
  /** Searched bases that ran full-text only. */
  degradedBaseIds: string[];
  /** Requested bases that could not be searched. */
  skipped: Array<{ baseId: string; reason: KnowledgeSearchSkipReason; message?: string }>;
};

export const KNOWLEDGE_SEARCH_DEFAULT_LIMIT = 8;
export const KNOWLEDGE_SEARCH_MAX_LIMIT = 30;

/** Agent tool names. `note_search`/`note_read` are not registered alongside these; `note_list` (enumerate notes) still is. */
export const KNOWLEDGE_TOOL_NAMES = {
  list: 'knowledge_list',
  search: 'knowledge_search',
  read: 'knowledge_read',
} as const;

export const KNOWLEDGE_CITATIONS_DETAILS_KIND = 'knowledge-citations';

/** `ToolResult.details` of `knowledge_search` / `knowledge_read`, read by clients to render citations. */
export type KnowledgeToolDetails = {
  kind: typeof KNOWLEDGE_CITATIONS_DETAILS_KIND;
  citations: KnowledgeCitation[];
  degradedBaseIds: string[];
};

export function readKnowledgeToolDetails(details: unknown): KnowledgeToolDetails | null {
  if (typeof details !== 'object' || details === null) {
    return null;
  }
  const candidate = details as Partial<KnowledgeToolDetails>;
  if (candidate.kind !== KNOWLEDGE_CITATIONS_DETAILS_KIND || !Array.isArray(candidate.citations)) {
    return null;
  }
  return {
    kind: KNOWLEDGE_CITATIONS_DETAILS_KIND,
    citations: candidate.citations,
    degradedBaseIds: Array.isArray(candidate.degradedBaseIds) ? candidate.degradedBaseIds : [],
  };
}

export type KnowledgeOpenSourceResult =
  | { kind: 'notes'; noteId: string }
  | {
      kind: 'folder';
      absolutePath: string;
      startLine?: number;
      pageStart?: number;
      /** True when the Host opened the file itself (local Host only). */
      opened: boolean;
    };

export type KnowledgeBaseListResult = { bases: KnowledgeBaseSummary[] };
export type KnowledgeBaseMutationResult = { base: KnowledgeBaseSummary };
export type KnowledgeBaseRemoveResult = { removed: true; baseId: string };
export type SessionKnowledgeBasesResult = { sessionId: string; baseIds: string[] };

export type WikiConceptItem = {
  title: string;
  slug: string;
  summary?: string;
  tags: string[];
  updatedAt: string;
  relativePath: string;
};

export type WikiPageKind = 'concept' | 'note' | 'topic';

export type WikiConceptDetail = {
  title: string;
  slug: string;
  content: string;
  summary?: string;
  tags: string[];
  aliases?: string[];
  links: string[];
  updatedAt: string;
  relativePath: string;
  /** Provenance captured at create time; absent on pages written before sources. */
  sources?: WikiSourceRef[];
  /** sha256 of the raw file; CAS token for `knowledge/wiki/update`. */
  contentHash?: string;
  /** Defaults to `concept` when omitted (pages written before kinds). */
  kind?: WikiPageKind;
};

/** One material slice a wiki page was saved from. Identity is base + path. */
export type WikiSourceRef = {
  baseId: string;
  relativePath: string;
  lineStart?: number;
  lineEnd?: number;
  snapshotText?: string;
};

/** Create a wiki concept. Host refuses when the slug already exists. */
export type WikiWriteInput = {
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  sources?: WikiSourceRef[];
  logMessage?: string;
  kind?: WikiPageKind;
};

/** Patch an existing wiki page. `expectedContentHash` is the last `wiki/concept` hash. */
export type WikiUpdateInput = {
  slug: string;
  expectedContentHash: string;
  title?: string;
  content?: string;
  summary?: string;
  tags?: string[];
  sources?: WikiSourceRef[];
  kind?: WikiPageKind;
  logMessage?: string;
};

export type WikiOverviewResult = {
  indexContent: string;
  logSnippet: string;
  concepts: WikiConceptItem[];
  totalConcepts: number;
};

/** One concept distilled from a source base, plus where it came from. */
export type WikiDistillResult = {
  concept: WikiConceptDetail;
  /** Source base the raw slices were read from. */
  baseId: string;
  /** Relative paths of the slices that fed the synthesis. */
  sourcePaths: string[];
};

/** Existing wiki page that the draft might update instead of creating. */
export type WikiRelatedPage = {
  slug: string;
  title: string;
  summary?: string;
  reason: 'same-slug' | 'title' | 'tag';
};

/** Synthesised concept that has not been written yet. */
export type WikiDistillDraft = {
  title: string;
  summary: string;
  tags: string[];
  content: string;
  sources: WikiSourceRef[];
  relatedPages: WikiRelatedPage[];
  existingPage?: {
    slug: string;
    title: string;
    content: string;
    contentHash: string;
  };
};

/** Which knowledge capability endpoint a Host-side connection probe targets. */
export type KnowledgeConnectionTestKind = 'embedding' | 'reranker' | 'mineru' | 'unstructured';

export type KnowledgeConnectionTestResult = {
  durationMs: number;
  /** Embedding probes report the vector width the endpoint returned. */
  dimension?: number;
};

/**
 * Probes one knowledge endpoint from the Host.
 *
 * The desktop WebView runs under a CSP with `connect-src 'self' ipc: …`, so a
 * renderer-side fetch to an embedding / reranker / parser base URL never leaves
 * the app. The probe therefore runs where the network is — the Host — and only
 * the timings travel back.
 *
 * `baseUrl` / `model` carry the live draft values: the point of the button is
 * to test before saving. `apiKey` is one-shot and never persisted;
 * `apiKeyRef` / `apiKeyEnv` are resolved by the Host secret store so a stored
 * key never travels back into the renderer.
 */
export type KnowledgeConnectionTestCommand = {
  id?: string;
  type: 'knowledge/test-connection';
  kind: KnowledgeConnectionTestKind;
  baseUrl: string;
  provider?: 'openai-compatible' | 'ollama';
  model?: string;
  apiKey?: string;
  apiKeyRef?: string;
  apiKeyEnv?: string;
};

/** Lists embedding model IDs from the draft endpoint without changing config.
 * A remote shell may send a redacted stored-secret marker; Host resolves its
 * saved credential. A just-typed apiKey is used only for this request.
 */
export type KnowledgeEmbeddingModelsDiscoverCommand = {
  id?: string;
  type: 'knowledge/embedding-models/discover';
  baseUrl: string;
  apiKey?: string;
  apiKeyRef?: string;
  apiKeyEnv?: string;
};

export type KnowledgeBaseHostCommand =
  | { id?: string; type: 'knowledge/bases/list' }
  /** Idempotent: re-adding a registered folder returns the existing base. */
  | { id?: string; type: 'knowledge/bases/add'; folderPath: string; name?: string }
  | { id?: string; type: 'knowledge/bases/rename'; baseId: string; name: string }
  /** `deleteIndex` also drops `~/.piwin/doc-rag/<folderKey>/`. The notes base cannot be removed. */
  | { id?: string; type: 'knowledge/bases/remove'; baseId: string; deleteIndex: boolean }
  /** Omitted `baseIds` searches every `ready` / `partial` base. */
  /**
   * `tags` narrows the candidate set (frontmatter `metadata.tags` equality,
   * any-of) *before* ranking and `limit` — never a post-hoc filter on results,
   * or a match past the cut would come back as no results. Not a relevance signal.
   */
  | {
      id?: string;
      type: 'knowledge/search';
      query: string;
      baseIds?: string[];
      tags?: string[];
      limit?: number;
    }
  | { id?: string; type: 'knowledge/open-source'; citation: KnowledgeCitation; openFile?: boolean }
  /** Replaces the session's mounted bases. Unknown ids are rejected. */
  | { id?: string; type: 'session/set-knowledge-bases'; sessionId: string; baseIds: string[] }
  /** LLM Wiki overview (index, log snippet, concept summaries). */
  | { id?: string; type: 'knowledge/wiki/overview' }
  /** Read full detail of one concept by slug or name. */
  | { id?: string; type: 'knowledge/wiki/concept'; slug: string }
  /**
   * Synthesises one wiki concept from a source base's indexed slices and
   * writes it into the wiki (INDEX.md and LOG.md follow). Needs a configured
   * model; `topic` narrows which slices are retrieved.
   */
  | { id?: string; type: 'knowledge/wiki/distill'; baseId: string; topic?: string }
  /** Synthesise a draft without writing. `relativePaths` limits retrieval to those files. */
  | {
      id?: string;
      type: 'knowledge/wiki/distill-draft';
      baseId: string;
      topic?: string;
      relativePaths?: string[];
    }
  /** Create-only: never overwrites an existing concept file. */
  | { id?: string; type: 'knowledge/wiki/write'; input: WikiWriteInput }
  /** CAS update: refuses when the file no longer matches `expectedContentHash`. */
  | { id?: string; type: 'knowledge/wiki/update'; input: WikiUpdateInput }
  /** Connectivity probe for one configured knowledge endpoint (see the type above). */
  | KnowledgeConnectionTestCommand
  | KnowledgeEmbeddingModelsDiscoverCommand
  /** Workspace-level reads (topic collections). See `knowledge-workspace.ts`. */
  | KnowledgeWorkspaceHostCommand
  /** Bounded document browsing and reading. See `knowledge-library.ts`. */
  | KnowledgeDocumentListCommand
  | KnowledgeDocumentReadCommand;

/** Full list on any registry or derived-state change. */
export type KnowledgeBasesChangedPush = {
  type: 'knowledge/bases-changed';
  bases: KnowledgeBaseSummary[];
};

/** Old Hosts omit this flag; clients fall back to the flashcards / notes entries. */
export function hostSupportsKnowledgeBases(
  capabilities: { knowledgeBases?: boolean } | undefined,
): boolean {
  return capabilities?.knowledgeBases === true;
}
