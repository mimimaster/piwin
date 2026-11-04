/**
 * Materials library: list one registered folder's documents and read one of
 * them in a bounded window.
 *
 * Two invariants drive this module:
 *
 * 1. **Browsing never consults the index.** Files come from the filesystem walk
 *    (`scanFolderFiles`), so a folder registered one second ago lists its
 *    documents and reads fine. Index state is attached per document for the
 *    "readable, not yet searchable" badge — never as a gate.
 * 2. **Reads are bounded and say so.** A window returns `totalLines` and
 *    `hasMore`; the reader can page through a long document without the Host
 *    ever shipping the whole file or silently truncating it.
 *
 * Path safety reuses the doc-rag primitives (`isSafeRelativePath` +
 * `isPathConfined`) so a traversal attempt fails the same way `knowledge/open-source`
 * fails, not with a fresh dialect.
 */
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type {
  KnowledgeBaseSummary,
  KnowledgeDocumentEntry,
  KnowledgeDocumentListResult,
  KnowledgeDocumentReadResult,
} from '@piwin/contracts';
import { isPathConfined, isSafeRelativePath, scanFolderFiles } from '@piwin/doc-rag';
import type { FolderDocumentRecord, FolderRag } from '@piwin/doc-rag';
import { KnowledgePathEscapeError } from './knowledge-tools.js';

export class KnowledgeDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeDocumentError';
  }
}

/** Extensions this reader opens as text. Anything else needs a parser. */
const TEXT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdx',
  'txt',
  'text',
  'rst',
  'org',
  'adoc',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'ini',
  'csv',
  'tsv',
  'log',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'sh',
  'zsh',
  'bash',
  'sql',
  'css',
  'scss',
  'html',
  'htm',
  'xml',
  'vue',
  'svelte',
  'tex',
]);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const DEFAULT_READ_LINES = 400;
const MAX_READ_LINES = 800;
const MAX_READ_CHARS = 60_000;

export type KnowledgeDocumentsRuntime = {
  getFolderRag: () => Promise<FolderRag>;
  /** Already-loaded registry rows; the command layer resolves them once. */
  bases: readonly KnowledgeBaseSummary[];
};

function extensionOf(relativePath: string): string {
  return extname(relativePath).replace(/^\./, '').toLowerCase();
}

function titleOf(relativePath: string): string {
  const file = relativePath.split('/').pop() ?? relativePath;
  const ext = extname(file);
  return ext.length > 0 ? file.slice(0, -ext.length) : file;
}

const UNSUPPORTED_REASONS: Record<string, string> = {
  MINERU_NOT_CONFIGURED: 'PDF 需要配置 MinerU 解析后才能阅读',
  UNSTRUCTURED_NOT_CONFIGURED: 'Office 文件需要配置 Unstructured 解析后才能阅读',
  UNSUPPORTED_FILE_TYPE: '暂不支持这种格式的文本阅读',
};

/** Index state per relative path; empty when the folder was never indexed. */
async function readIndexState(
  runtime: KnowledgeDocumentsRuntime,
  folderPath: string,
): Promise<Map<string, number>> {
  const state = new Map<string, number>();
  try {
    const rag = await runtime.getFolderRag();
    if (!(await rag.isIndexed(folderPath))) return state;
    const documents: FolderDocumentRecord[] = await rag.listDocuments(folderPath);
    for (const document of documents) {
      state.set(document.relativePath, document.chunkCount);
    }
  } catch {
    // An unreadable index is "not indexed" for browsing purposes. The list must
    // still work; search reports its own errors.
  }
  return state;
}

function toEntry(
  relativePath: string,
  sizeBytes: number,
  language: string,
  indexState: Map<string, number>,
  unsupportedReason?: string,
): KnowledgeDocumentEntry {
  const extension = extensionOf(relativePath);
  const readable = unsupportedReason === undefined && TEXT_EXTENSIONS.has(extension);
  const chunkCount = indexState.get(relativePath) ?? 0;
  const reason = readable
    ? undefined
    : (unsupportedReason !== undefined ? UNSUPPORTED_REASONS[unsupportedReason] : undefined) ??
      '这种格式需要解析器，当前只能看到条目';
  return {
    relativePath,
    title: titleOf(relativePath),
    extension,
    sizeBytes,
    language,
    indexed: chunkCount > 0,
    chunkCount,
    readability: readable ? 'text' : 'unsupported',
    ...(reason ? { unsupportedReason: reason } : {}),
  };
}

export async function listKnowledgeDocuments(
  runtime: KnowledgeDocumentsRuntime,
  args: { baseId: string; cursor?: string; limit?: number; query?: string },
): Promise<KnowledgeDocumentListResult> {
  const base = runtime.bases.find((entry) => entry.id === args.baseId);
  if (!base) throw new KnowledgeDocumentError(`Unknown knowledge base: ${args.baseId}`);
  const folderPath = base.folderPath;
  if (!folderPath) throw new KnowledgeDocumentError(`Knowledge base has no folder: ${base.id}`);

  const scan = await scanFolderFiles(folderPath).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new KnowledgeDocumentError(message);
  });
  const indexState = await readIndexState(runtime, folderPath);

  const entries: KnowledgeDocumentEntry[] = [];
  for (const file of scan.files) {
    entries.push(toEntry(file.relativePath, file.sizeBytes, file.language, indexState));
  }
  for (const file of scan.unsupported ?? []) {
    entries.push(
      toEntry(
        file.relativePath,
        file.sizeBytes,
        'text',
        indexState,
        file.unsupportedReason ?? 'UNSUPPORTED_FILE_TYPE',
      ),
    );
  }

  const needle = args.query?.trim().toLowerCase();
  const filtered = needle
    ? entries.filter((entry) => entry.relativePath.toLowerCase().includes(needle))
    : entries;
  filtered.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(args.limit ?? DEFAULT_PAGE_SIZE)),
  );
  const cursor = args.cursor;
  const start =
    cursor !== undefined
      ? filtered.findIndex((entry) => entry.relativePath > cursor)
      : 0;
  const from = start === -1 ? filtered.length : start;
  const page = filtered.slice(from, from + limit);
  const hasMore = from + page.length < filtered.length;

  await attachTimestamps(folderPath, page);

  return {
    baseId: base.id,
    folderPath,
    items: page,
    ...(hasMore && page.length > 0
      ? { nextCursor: page[page.length - 1]?.relativePath ?? '' }
      : {}),
    total: filtered.length,
  };
}

async function attachTimestamps(
  folderPath: string,
  entries: KnowledgeDocumentEntry[],
): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const info = await stat(join(folderPath, entry.relativePath));
        entry.updatedAt = info.mtime.toISOString();
        entry.sizeBytes = info.size;
      } catch {
        // The file vanished between the walk and this stat; the row stays with
        // the walk's size and no timestamp.
      }
    }),
  );
}

export async function readKnowledgeDocument(
  runtime: KnowledgeDocumentsRuntime,
  args: { baseId: string; relativePath: string; startLine?: number; maxLines?: number },
): Promise<KnowledgeDocumentReadResult> {
  const base = runtime.bases.find((entry) => entry.id === args.baseId);
  if (!base) throw new KnowledgeDocumentError(`Unknown knowledge base: ${args.baseId}`);
  const folderPath = base.folderPath;
  if (!folderPath) throw new KnowledgeDocumentError(`Knowledge base has no folder: ${base.id}`);

  const relativePath = args.relativePath;
  if (!isSafeRelativePath(relativePath)) {
    throw new KnowledgePathEscapeError(relativePath);
  }
  const absolutePath = join(folderPath, relativePath);
  let info;
  try {
    info = await stat(absolutePath);
  } catch {
    throw new KnowledgeDocumentError(`Document not found: ${relativePath}`);
  }
  if (!info.isFile()) {
    throw new KnowledgeDocumentError(`Not a file: ${relativePath}`);
  }
  // Symlinks are checked after existence so "deleted" and "escapes the folder"
  // stay different errors instead of both reading as a traversal attempt.
  if (!(await isPathConfined(folderPath, relativePath))) {
    throw new KnowledgePathEscapeError(relativePath);
  }

  const extension = extensionOf(relativePath);
  const indexState = await readIndexState(runtime, folderPath);
  const chunkCount = indexState.get(relativePath) ?? 0;
  const indexed = chunkCount > 0;

  if (!TEXT_EXTENSIONS.has(extension)) {
    throw new KnowledgeDocumentError(
      UNSUPPORTED_REASONS.UNSUPPORTED_FILE_TYPE + `（.${extension || 'unknown'}）`,
    );
  }

  let raw: string;
  try {
    raw = await readFile(join(folderPath, relativePath), 'utf8');
  } catch {
    throw new KnowledgeDocumentError(`Document not found: ${relativePath}`);
  }

  const lines = raw.split(/\r?\n/);
  const totalLines = lines.length;
  const requestedStart = Math.max(1, Math.floor(args.startLine ?? 1));
  const startLine = Math.min(requestedStart, Math.max(1, totalLines));
  const maxLines = Math.min(
    MAX_READ_LINES,
    Math.max(1, Math.floor(args.maxLines ?? DEFAULT_READ_LINES)),
  );
  const endLine = Math.min(totalLines, startLine + maxLines - 1);
  const slice = lines.slice(startLine - 1, endLine).join('\n');
  const truncatedChars = slice.length > MAX_READ_CHARS;
  const text = truncatedChars ? slice.slice(0, MAX_READ_CHARS) : slice;

  return {
    baseId: base.id,
    relativePath,
    title: titleOf(relativePath),
    language: extension === 'md' ? 'markdown' : extension,
    text,
    startLine,
    endLine,
    totalLines,
    hasMore: endLine < totalLines || truncatedChars,
    truncatedChars,
    indexed,
    chunkCount,
    readability: 'text',
  };
}
