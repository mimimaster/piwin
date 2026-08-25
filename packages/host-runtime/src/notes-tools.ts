/**
 * Host customTools for the notes library (ADR 0018).
 * Pure tool descriptors; permission gate wraps execute at registration.
 */
import type {
  EmbeddingProvider,
  HostToolPermissionSpec,
  HostToolRegistration,
  NoteSearchQuery,
  NoteUpdateInput,
  NoteWriteInput,
  ToolResult,
} from '@piwin/contracts';
import { HEALTH_MODEL_OUTPUT_PREAMBLE, isHealthSensitiveToolResult } from '@piwin/contracts';
import type { NoteIndex, NoteStore, SearchNotesOptions } from '@piwin/notes';
import { searchNotes } from '@piwin/notes';
import type { NotesPermissionAction } from './permission-policy.js';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';

export type BuildNotesToolsOptions = {
  store: NoteStore;
  index: NoteIndex;
  /** When false, returns no tools. */
  enabled: boolean;
  /** When set, note_search runs hybrid (FTS + vector RRF); absent = FTS-only. */
  embeddingProvider?: EmbeddingProvider;
  /** Optional LLM rerank stage (config.notes.rerank.enabled). */
  rerankProvider?: import('@piwin/contracts').RerankProvider;
  /** RRF constant override (config.notes.search.rrfK). */
  rrfK?: number;
  /**
   * When true, only return read-only tools (note_search, note_list, note_read).
   * Used by the knowledge tool profile (doc-flashcards §10.2).
   */
  readOnly?: boolean;
};

function notesPermissionSpec(
  action: NotesPermissionAction,
  mutation: boolean,
): HostToolPermissionSpec {
  return {
    action: `notes:${action}`,
    risk: mutation ? 'unknown' : 'unknown',
    rememberable: false,
    ...(mutation ? {} : { readOnly: true }),
    ...(mutation ? { subjectBuilder: () => ({ kind: 'notes-mutate' as const }) } : {}),
  };
}

function invalidNotesInput(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

function rejectHealthSensitiveNoteSource(args: Record<string, unknown>): ToolResult | undefined {
  const source = isNotesRecord(args.sourceDetails) ? args.sourceDetails : args;
  const content = typeof args.content === 'string' ? args.content : '';
  if (
    !isHealthSensitiveToolResult(source) &&
    !content.includes(HEALTH_MODEL_OUTPUT_PREAMBLE)
  ) {
    return undefined;
  }
  return {
    ok: false,
    code: 'permission-denied',
    message: 'Health-sensitive tool results cannot be stored in Notes.',
  };
}

function isNotesRecord(value: unknown): value is { sensitivity?: string } {
  return typeof value === 'object' && value !== null;
}

export function buildNotesTools(options: BuildNotesToolsOptions): HostToolRegistration[] {
  if (!options.enabled) {
    return [];
  }
  const searchOptions: SearchNotesOptions = {};
  if (options.embeddingProvider) {
    searchOptions.embeddingProvider = options.embeddingProvider;
  }
  if (options.rerankProvider) {
    searchOptions.rerankProvider = options.rerankProvider;
  }
  if (options.rrfK !== undefined) {
    searchOptions.rrfK = options.rrfK;
  }
  const bare = createNotesToolDefinitions(options.store, options.index, searchOptions);
  const filtered = options.readOnly
    ? bare.filter(
        (tool) =>
          tool.descriptor.name === 'note_search' ||
          tool.descriptor.name === 'note_list' ||
          tool.descriptor.name === 'note_read',
      )
    : bare;
  return filtered;
}

function createNotesToolDefinitions(
  store: NoteStore,
  index: NoteIndex,
  searchOptions: SearchNotesOptions,
): HostToolRegistration[] {
  return [
    {
      descriptor: {
        name: 'note_search',
        description:
          'Search the user notes library (full-text, CJK-aware). Returns ranked hits with snippets. Use this to ground answers in the user notes (RAG).',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            collection: { type: 'string', description: 'Optional collection filter' },
            tags: { type: 'array', items: { type: 'string' } },
            limit: { type: 'number', description: 'Max hits, default 10' },
          },
          required: ['query'],
        },
      },
      family: 'notes-read',
      permissionSpec: notesPermissionSpec('note_search', false),
      async execute(args) {
        const query: NoteSearchQuery = { query: String(args.query ?? '') };
        if (typeof args.collection === 'string' && args.collection) {
          query.collection = args.collection;
        }
        if (Array.isArray(args.tags)) {
          const tags = args.tags.filter((item): item is string => typeof item === 'string');
          if (tags.length > 0) query.tags = tags;
        }
        if (typeof args.limit === 'number') query.limit = args.limit;
        if (!query.query.trim()) return invalidNotesInput('query is required');
        const hits = await searchNotes(index, query, searchOptions);
        return {
          ok: true,
          output: JSON.stringify(
            hits.map((hit) => ({
              id: hit.note.id,
              title: hit.note.title,
              collection: hit.note.collection,
              tags: hit.note.tags,
              snippet: hit.snippet,
              score: hit.score,
              channels: hit.channels,
            })),
            null,
            2,
          ),
          details: { count: hits.length },
        };
      },
    },
    {
      descriptor: {
        name: 'note_list',
        description: 'List notes (id, title, collection, tags), newest first.',
        parameters: {
          type: 'object',
          properties: {
            collection: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      family: 'notes-read',
      permissionSpec: notesPermissionSpec('note_list', false),
      async execute(args) {
        const filter: { collection?: string; tags?: string[] } = {};
        if (typeof args.collection === 'string' && args.collection) {
          filter.collection = args.collection;
        }
        if (Array.isArray(args.tags)) {
          const tags = args.tags.filter((item): item is string => typeof item === 'string');
          if (tags.length > 0) filter.tags = tags;
        }
        const records = await store.list(filter);
        return {
          ok: true,
          output: JSON.stringify(
            records.map((record) => ({
              id: record.id,
              title: record.title,
              collection: record.collection,
              tags: record.tags,
              updatedAt: record.updatedAt,
            })),
            null,
            2,
          ),
          details: { count: records.length },
        };
      },
    },
    {
      descriptor: {
        name: 'note_read',
        description: 'Read a full note by id, including markdown content.',
        parameters: {
          type: 'object',
          properties: {
            noteId: { type: 'string' },
          },
          required: ['noteId'],
        },
      },
      family: 'notes-read',
      permissionSpec: notesPermissionSpec('note_read', false),
      async execute(args) {
        const noteId = String(args.noteId ?? '').trim();
        if (!noteId) return invalidNotesInput('noteId is required');
        const record = await store.read(noteId);
        return { ok: true, output: JSON.stringify(record, null, 2), details: { noteId } };
      },
    },
    {
      descriptor: {
        name: 'note_write',
        description: 'Create a new note in the user notes library.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string', description: 'Markdown body' },
            collection: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'content'],
        },
      },
      family: 'notes-write',
      permissionSpec: notesPermissionSpec('note_write', true),
      prepareArgs: passThroughPrepareArgs,
      async execute(args) {
        const blocked = rejectHealthSensitiveNoteSource(args);
        if (blocked) return blocked;
        const writeInput: NoteWriteInput = {
          title: String(args.title ?? ''),
          content: String(args.content ?? ''),
        };
        if (!writeInput.title.trim()) return invalidNotesInput('title is required');
        if (typeof args.collection === 'string' && args.collection) {
          writeInput.collection = args.collection;
        }
        if (Array.isArray(args.tags)) {
          const tags = args.tags.filter((item): item is string => typeof item === 'string');
          if (tags.length > 0) writeInput.tags = tags;
        }
        const record = await store.write(writeInput);
        return {
          ok: true,
          output: JSON.stringify(record, null, 2),
          details: { noteId: record.id },
        };
      },
    },
    {
      descriptor: {
        name: 'note_update',
        description: 'Update an existing note by id (title, content, and/or tags).',
        parameters: {
          type: 'object',
          properties: {
            noteId: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['noteId'],
        },
      },
      family: 'notes-write',
      permissionSpec: notesPermissionSpec('note_update', true),
      prepareArgs: passThroughPrepareArgs,
      async execute(args) {
        const blocked = rejectHealthSensitiveNoteSource(args);
        if (blocked) return blocked;
        const noteId = String(args.noteId ?? '').trim();
        if (!noteId) return invalidNotesInput('noteId is required');
        const updateInput: NoteUpdateInput = { id: noteId };
        if (typeof args.title === 'string') updateInput.title = args.title;
        if (typeof args.content === 'string') updateInput.content = args.content;
        if (Array.isArray(args.tags)) {
          updateInput.tags = args.tags.filter((item): item is string => typeof item === 'string');
        }
        const record = await store.update(updateInput);
        return { ok: true, output: JSON.stringify(record, null, 2), details: { noteId } };
      },
    },
    {
      descriptor: {
        name: 'note_delete',
        description: 'Delete a note by id.',
        parameters: {
          type: 'object',
          properties: {
            noteId: { type: 'string' },
          },
          required: ['noteId'],
        },
      },
      family: 'notes-write',
      permissionSpec: notesPermissionSpec('note_delete', true),
      prepareArgs: passThroughPrepareArgs,
      async execute(args) {
        const noteId = String(args.noteId ?? '').trim();
        if (!noteId) return invalidNotesInput('noteId is required');
        const result = await store.delete(noteId);
        return { ok: true, output: JSON.stringify(result, null, 2), details: { noteId } };
      },
    },
  ];
}
