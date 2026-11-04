/**
 * Materials library protocol: browse a registered folder document by document
 * and read one document in a bounded window.
 *
 * Browsing never consults the search index. A folder that was just registered,
 * or whose index is stale, still lists and reads its files — "not indexed" is a
 * search capability state, not a readability state. `indexed` / `chunkCount`
 * are reported per document so the UI can say "readable, not yet searchable"
 * instead of blocking the list.
 *
 * See `docs/adr/0103-knowledge-workspace-integration.md` and plan stage 2.
 */

/** Why a listed file can (or cannot) be opened as text. */
export type KnowledgeDocumentReadability = 'text' | 'unsupported';

/** One document row. `relativePath` is the identity inside the base. */
export type KnowledgeDocumentEntry = {
  relativePath: string;
  /** Basename without the extension; the reader shows the path as context. */
  title: string;
  extension: string;
  sizeBytes: number;
  language: string;
  /** ISO timestamp from the file's `mtime`, when the Host could stat it. */
  updatedAt?: string;
  /** True when this document has chunks in the derived index. */
  indexed: boolean;
  chunkCount: number;
  readability: KnowledgeDocumentReadability;
  /** Why the file needs a parser (PDF without MinerU, Office without Unstructured). */
  unsupportedReason?: string;
};

export type KnowledgeDocumentListResult = {
  baseId: string;
  /** Absolute folder path, for display only; the client never builds paths. */
  folderPath: string;
  items: KnowledgeDocumentEntry[];
  /** Pass back as `cursor` for the next page; absent on the last page. */
  nextCursor?: string;
  /** Documents matching the filter, across all pages. */
  total: number;
};

export type KnowledgeDocumentListCommand = {
  id?: string;
  type: 'knowledge/documents/list';
  baseId: string;
  /** Opaque cursor from the previous page (the last `relativePath` seen). */
  cursor?: string;
  /** Default 50, capped by the Host. */
  limit?: number;
  /** Case-insensitive substring match on `relativePath`. */
  query?: string;
};

export type KnowledgeDocumentReadResult = {
  baseId: string;
  relativePath: string;
  title: string;
  language: string;
  /** The bounded window, exactly `startLine`..`endLine`. */
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  /** More lines exist after `endLine`. */
  hasMore: boolean;
  /** One line exceeded the Host's character cap and was cut. */
  truncatedChars: boolean;
  indexed: boolean;
  chunkCount: number;
  readability: KnowledgeDocumentReadability;
};

export type KnowledgeDocumentReadCommand = {
  id?: string;
  type: 'knowledge/document/read';
  baseId: string;
  relativePath: string;
  /** 1-based, default 1. */
  startLine?: number;
  /** Window size, default 400; the Host caps it and reports what it returned. */
  maxLines?: number;
};

/** Old Hosts omit this flag; the library falls back to source-level browsing. */
export function hostSupportsKnowledgeDocuments(
  capabilities: { knowledgeDocuments?: boolean } | undefined,
): boolean {
  return capabilities?.knowledgeDocuments === true;
}

/**
 * How much of the library a question or an action is scoped to. The four
 * scopes are deliberately ordered from narrowest to widest so a caller can
 * fall back outward when a narrower scope has no text (`selection` -> `page`
 * -> `topic` -> `global`) without guessing at enum values.
 */
export type KnowledgeSelectionScope = 'selection' | 'page' | 'topic' | 'global';

/**
 * A captured piece of library text, plus where it came from.
 *
 * `baseId` + `relativePath` + the line range is the identity; `snapshotText`
 * is what the user actually saw, re-bounded by the Host on use. The client
 * never builds an absolute path from this — `folderPath` stays a Host-only
 * display value.
 */
export type KnowledgeSelectionAnchor = {
  baseId: string;
  scope: KnowledgeSelectionScope;
  /** Absent for `topic` / `global`, which are not bound to one document. */
  relativePath?: string;
  /** 1-based inclusive line range inside `relativePath`. */
  lineStart?: number;
  lineEnd?: number;
  /** The selection as shown, already capped by the client. */
  snapshotText: string;
  /** Short human label, e.g. `notes/sleep-debt.md · 3–5`. */
  label: string;
};

/** The four selection actions the library menu offers, plus Copy. */
export type KnowledgeSelectionAction =
  | 'copy'
  | 'ask-ai'
  | 'add-to-chat'
  | 'save-note'
  | 'generate-flashcard';

/** Narrower scopes win; widest is `global`. Used when a scope has no text. */
export function widenKnowledgeScope(scope: KnowledgeSelectionScope): KnowledgeSelectionScope {
  switch (scope) {
    case 'selection':
      return 'page';
    case 'page':
      return 'topic';
    case 'topic':
      return 'global';
    case 'global':
      return 'global';
  }
}

/** Prompt context chip for a library selection. Host re-bounds; UI never builds paths. */
export type KnowledgeContextRef = KnowledgeSelectionAnchor & {
  kind: 'knowledge-selection';
};

const KNOWLEDGE_SELECTION_SCOPES: ReadonlySet<KnowledgeSelectionScope> = new Set([
  'selection',
  'page',
  'topic',
  'global',
]);

/** Relative library paths only — no `..`, drive letters, or absolute roots. */
export function isSafeKnowledgeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.includes('..') &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value)
  );
}

/**
 * Shape + range gate used by prompt preparation and the remote Host boundary.
 * Rejects unknown scopes, escaped paths, and inverted line ranges. Never
 * inspects filesystem paths — callers must not log `folderPath` on failure.
 */
export function isUsableKnowledgeContextRef(ref: KnowledgeContextRef): boolean {
  if (!KNOWLEDGE_SELECTION_SCOPES.has(ref.scope)) return false;
  if (ref.baseId.length === 0 || ref.baseId.length > 256) return false;
  if (ref.label.length === 0 || ref.label.length > 512) return false;
  if (ref.snapshotText.length === 0 || ref.snapshotText.length > 64 * 1024) return false;
  if (ref.lineStart !== undefined && (!Number.isSafeInteger(ref.lineStart) || ref.lineStart < 1)) {
    return false;
  }
  if (ref.lineEnd !== undefined && (!Number.isSafeInteger(ref.lineEnd) || ref.lineEnd < 1)) {
    return false;
  }
  if (
    ref.lineStart !== undefined &&
    ref.lineEnd !== undefined &&
    ref.lineEnd < ref.lineStart
  ) {
    return false;
  }
  if (ref.scope === 'selection' || ref.scope === 'page') {
    return ref.relativePath !== undefined && isSafeKnowledgeRelativePath(ref.relativePath);
  }
  return ref.relativePath === undefined || isSafeKnowledgeRelativePath(ref.relativePath);
}
