/**
 * Agent tools for the unified knowledge base. Read-only.
 * When these are registered, note_search / note_list / note_read are omitted.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KNOWLEDGE_CITATIONS_DETAILS_KIND,
  KNOWLEDGE_TOOL_NAMES,
  parseKnowledgeBaseId,
  type HostToolPermissionSpec,
  type HostToolRegistration,
  type KnowledgeCitation,
  type KnowledgeToolDetails,
  type ToolResult,
} from '@piwin/contracts';
import { isPathConfined, isSafeRelativePath } from '@piwin/doc-rag';
import { getSessionRecord } from '@piwin/session';
import type { KnowledgeBaseRuntime } from './knowledge-base-service.js';
import { listKnowledgeBaseSummaries } from './knowledge-base-service.js';
import {
  clampKnowledgeSearchLimit,
  searchKnowledgeBases,
} from './knowledge-retriever.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';

export const KNOWLEDGE_READ_MAX_LINES = 200;
export const KNOWLEDGE_READ_MAX_CHARS = 16_000;
const MAX_REF_COUNTERS = 64;
const MAX_REF = 10_000;

const refCounters = new Map<string, number>();

export class KnowledgePathEscapeError extends Error {
  override readonly name = 'KnowledgePathEscapeError';
  constructor(readonly relativePath: string) {
    super(`Path is not confined to the knowledge base folder: ${relativePath}`);
  }
}

export type BuildKnowledgeToolsOptions = KnowledgeBaseRuntime & {
  sessionId: string;
};

function knowledgePermissionSpec(
  action: 'knowledge_list' | 'knowledge_search' | 'knowledge_read',
): HostToolPermissionSpec {
  return {
    action: `knowledge:${action}`,
    risk: 'unknown',
    rememberable: false,
    readOnly: true,
  };
}

function invalidInput(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

export function formatKnowledgeCitationsText(citations: readonly KnowledgeCitation[]): string {
  if (citations.length === 0) {
    return 'No relevant passages were found in the knowledge base.';
  }
  return citations
    .map((citation) => {
      const location = formatCitationLocation(citation);
      return `[${citation.ref}] ${citation.baseName} · ${location}\n${citation.text}`;
    })
    .join('\n\n');
}

export function formatCitationLocation(citation: KnowledgeCitation): string {
  if (citation.kind === 'notes') {
    return citation.title;
  }
  const path = citation.relativePath ?? citation.title;
  if (citation.startLine !== undefined) {
    const end = citation.endLine ?? citation.startLine;
    return end !== citation.startLine ? `${path}:${citation.startLine}-${end}` : `${path}:${citation.startLine}`;
  }
  if (citation.pageStart !== undefined) {
    const end = citation.pageEnd ?? citation.pageStart;
    return end !== citation.pageStart
      ? `${path}:p.${citation.pageStart}-${end}`
      : `${path}:p.${citation.pageStart}`;
  }
  return path;
}

function touchRefCounter(runId: string): void {
  if (refCounters.size >= MAX_REF_COUNTERS && !refCounters.has(runId)) {
    const oldest = refCounters.keys().next().value;
    if (oldest !== undefined) refCounters.delete(oldest);
  }
}

export function nextKnowledgeRefStart(runId: string): number {
  touchRefCounter(runId);
  return Math.min(MAX_REF, (refCounters.get(runId) ?? 0) + 1);
}

export function commitKnowledgeRefs(runId: string, lastRef: number): void {
  touchRefCounter(runId);
  refCounters.set(runId, Math.min(MAX_REF, Math.max(0, lastRef)));
}

export function resetKnowledgeRefCounters(): void {
  refCounters.clear();
}

function citationsDetails(
  citations: KnowledgeCitation[],
  degradedBaseIds: string[],
): KnowledgeToolDetails {
  return {
    kind: KNOWLEDGE_CITATIONS_DETAILS_KIND,
    citations,
    degradedBaseIds,
  };
}

const SEARCH_GROUNDING =
  'RAG Grounding: Base answers strictly on the returned snippets; cite them as [n]. ' +
  'If nothing relevant is found, say not found in the knowledge base without using general knowledge.';

export function buildKnowledgeTools(options: BuildKnowledgeToolsOptions): HostToolRegistration[] {
  return [
    {
      descriptor: {
        name: KNOWLEDGE_TOOL_NAMES.list,
        description:
          'List knowledge bases (id, name, state, document count, whether mounted on this session).',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      family: 'notes-read',
      permissionSpec: knowledgePermissionSpec('knowledge_list'),
      async execute() {
        const bases = await listKnowledgeBaseSummaries(options);
        const mounted = new Set(await loadMountedBaseIds(options));
        const lines = bases.map((base) => {
          const mountedLabel = mounted.has(base.id) ? 'mounted' : 'not-mounted';
          return `${base.id}\t${base.name}\t${base.state}\t${base.documentCount}\t${mountedLabel}`;
        });
        return {
          ok: true,
          output: lines.join('\n'),
          details: { bases, mountedBaseIds: [...mounted] },
        };
      },
    },
    {
      descriptor: {
        name: KNOWLEDGE_TOOL_NAMES.search,
        description:
          'Search the knowledge bases available to this session (mounted bases, or every ready/partial base when none are mounted). ' +
          SEARCH_GROUNDING,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            baseIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional knowledge base ids to search',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional frontmatter tags; any-of match, applied before ranking',
            },
            limit: { type: 'number', description: 'Max citations, default 8' },
          },
          required: ['query'],
        },
      },
      family: 'notes-read',
      permissionSpec: knowledgePermissionSpec('knowledge_search'),
      async execute(args, _signal, context) {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (!query) return invalidInput('query is required');
        const limit =
          typeof args.limit === 'number' ? clampKnowledgeSearchLimit(args.limit) : undefined;
        const requestedIds = parseStringArray(args.baseIds);
        const tags = parseStringArray(args.tags);
        const scopedIds = await resolveSearchBaseIds(options, requestedIds);
        const searchStart = nextKnowledgeRefStart(context.runId);
        const result = await searchKnowledgeBases(options, {
          query,
          ...(scopedIds ? { baseIds: scopedIds } : {}),
          ...(tags ? { tags } : {}),
          ...(limit !== undefined ? { limit } : {}),
          startRef: searchStart,
        });
        const last = result.citations[result.citations.length - 1];
        if (last) {
          commitKnowledgeRefs(context.runId, last.ref);
        }
        return {
          ok: true,
          output: formatKnowledgeCitationsText(result.citations),
          details: citationsDetails(result.citations, result.degradedBaseIds),
        };
      },
    },
    {
      descriptor: {
        name: KNOWLEDGE_TOOL_NAMES.read,
        description:
          'Read a larger window around a knowledge citation. Folder reads are confined to the base root. ' +
          SEARCH_GROUNDING,
        parameters: {
          type: 'object',
          properties: {
            baseId: { type: 'string' },
            relativePath: { type: 'string', description: 'Folder-relative path' },
            noteId: { type: 'string' },
            startLine: { type: 'number' },
            endLine: { type: 'number' },
            pageStart: { type: 'number' },
            pageEnd: { type: 'number' },
          },
          required: ['baseId'],
        },
      },
      family: 'notes-read',
      permissionSpec: knowledgePermissionSpec('knowledge_read'),
      async execute(args, _signal, context) {
        const baseId = typeof args.baseId === 'string' ? args.baseId.trim() : '';
        if (!baseId) return invalidInput('baseId is required');
        const parsed = parseKnowledgeBaseId(baseId);
        if (!parsed) return invalidInput(`Unknown knowledge base: ${baseId}`);
        try {
          const ref = nextKnowledgeRefStart(context.runId);
          if (parsed.kind === 'notes') {
            const noteId = typeof args.noteId === 'string' ? args.noteId.trim() : '';
            if (!noteId) return invalidInput('noteId is required');
            const citation = await readNotesCitation(options, baseId, noteId, ref);
            commitKnowledgeRefs(context.runId, ref);
            return {
              ok: true,
              output: formatKnowledgeCitationsText([citation]),
              details: citationsDetails([citation], []),
            };
          }
          const relativePath =
            typeof args.relativePath === 'string' ? args.relativePath.trim() : '';
          if (!relativePath) return invalidInput('relativePath is required');
          const startLine = optionalPositiveInt(args.startLine);
          const endLine = optionalPositiveInt(args.endLine);
          const pageStart = optionalPositiveInt(args.pageStart);
          const pageEnd = optionalPositiveInt(args.pageEnd);
          const citation = await readFolderCitation(options, {
            baseId,
            relativePath,
            ref,
            ...(startLine !== undefined ? { startLine } : {}),
            ...(endLine !== undefined ? { endLine } : {}),
            ...(pageStart !== undefined ? { pageStart } : {}),
            ...(pageEnd !== undefined ? { pageEnd } : {}),
          });
          commitKnowledgeRefs(context.runId, ref);
          return {
            ok: true,
            output: formatKnowledgeCitationsText([citation]),
            details: citationsDetails([citation], []),
          };
        } catch (error) {
          if (error instanceof KnowledgePathEscapeError) {
            return {
              ok: false,
              code: 'invalid-input',
              message: error.message,
            };
          }
          throw error;
        }
      },
    },
  ];
}

async function resolveSearchBaseIds(
  options: BuildKnowledgeToolsOptions,
  requested: string[] | undefined,
): Promise<string[] | undefined> {
  if (requested && requested.length > 0) return requested;
  const mounted = await loadMountedBaseIds(options);
  return mounted.length > 0 ? mounted : undefined;
}

async function loadMountedBaseIds(options: BuildKnowledgeToolsOptions): Promise<string[]> {
  const indexPath = getPiwinSessionIndexPath(getPiwinRoot(options.piwinRoot));
  const record = await getSessionRecord(indexPath, options.sessionId);
  return record?.knowledgeBaseIds ?? [];
}

async function readNotesCitation(
  options: BuildKnowledgeToolsOptions,
  baseId: string,
  noteId: string,
  ref: number,
): Promise<KnowledgeCitation> {
  const bases = await listKnowledgeBaseSummaries(options);
  const base = bases.find((item) => item.id === baseId);
  if (!options.getNotesServices) {
    throw new Error('Notes services are not available');
  }
  const services = await options.getNotesServices();
  const record = await services.store.read(noteId);
  const text =
    record.content.length > KNOWLEDGE_READ_MAX_CHARS
      ? record.content.slice(0, KNOWLEDGE_READ_MAX_CHARS)
      : record.content;
  return {
    ref,
    baseId,
    baseName: base?.name ?? 'Notes',
    kind: 'notes',
    title: record.title,
    noteId: record.id,
    text,
  };
}

async function readFolderCitation(
  options: BuildKnowledgeToolsOptions,
  input: {
    baseId: string;
    relativePath: string;
    ref: number;
    startLine?: number;
    endLine?: number;
    pageStart?: number;
    pageEnd?: number;
  },
): Promise<KnowledgeCitation> {
  const bases = await listKnowledgeBaseSummaries(options);
  const base = bases.find((item) => item.id === input.baseId);
  if (!base?.folderPath) {
    throw new Error(`Unknown folder knowledge base: ${input.baseId}`);
  }
  const window = await readConfinedLineWindow(
    base.folderPath,
    input.relativePath,
    input.startLine,
    input.endLine,
  );
  const citation: KnowledgeCitation = {
    ref: input.ref,
    baseId: input.baseId,
    baseName: base.name,
    kind: 'folder',
    title: input.relativePath,
    relativePath: input.relativePath,
    startLine: window.startLine,
    endLine: window.endLine,
    text: window.text,
  };
  if (input.pageStart !== undefined) citation.pageStart = input.pageStart;
  if (input.pageEnd !== undefined) citation.pageEnd = input.pageEnd;
  return citation;
}

export async function readConfinedLineWindow(
  folderRoot: string,
  relativePath: string,
  startLine?: number,
  endLine?: number,
): Promise<{ text: string; startLine: number; endLine: number }> {
  if (!isSafeRelativePath(relativePath) || !(await isPathConfined(folderRoot, relativePath))) {
    throw new KnowledgePathEscapeError(relativePath);
  }
  const absolute = join(folderRoot, relativePath);
  const raw = await readFile(absolute, 'utf8');
  const lines = raw.split(/\r?\n/);
  const from = Math.max(1, startLine ?? 1);
  const defaultEnd = startLine === undefined ? Math.min(lines.length, 80) : from + 79;
  const requestedEnd = endLine ?? defaultEnd;
  const to = Math.min(lines.length, Math.max(from, requestedEnd), from + KNOWLEDGE_READ_MAX_LINES - 1);
  const slice = lines.slice(from - 1, to).join('\n');
  const text = slice.length > KNOWLEDGE_READ_MAX_CHARS ? slice.slice(0, KNOWLEDGE_READ_MAX_CHARS) : slice;
  return { text, startLine: from, endLine: to };
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  return n > 0 ? n : undefined;
}


