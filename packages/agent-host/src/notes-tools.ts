/**
 * Host customTools for the notes library (ADR 0018).
 * Pure tool descriptors; permission gate wraps execute at registration.
 */
import type {
  EmbeddingProvider,
  NoteSearchQuery,
  NoteUpdateInput,
  NoteWriteInput,
  PermissionDecision,
} from '@piwin/contracts';
import type { NoteIndex, NoteStore, SearchNotesOptions } from '@piwin/notes';
import { searchNotes } from '@piwin/notes';
import type { HostToolDefinition } from '@piwin/tools-web';
import {
  evaluateNotesPermission,
  resolveNonInteractiveDecision,
  type NotesPermissionAction,
} from './permission-policy.js';
import type { ToolPermissionGate } from './session-tools.js';

export type BuildNotesToolsOptions = {
  store: NoteStore;
  index: NoteIndex;
  /** When false, returns no tools. */
  enabled: boolean;
  /** When set, note_search runs hybrid (FTS + vector RRF); absent = FTS-only. */
  embeddingProvider?: EmbeddingProvider;
  /** RRF constant override (config.notes.search.rrfK). */
  rrfK?: number;
  requestPermission?: ToolPermissionGate;
};

const NOTES_TOOL_ACTIONS: Record<string, NotesPermissionAction> = {
  note_list: 'note_list',
  note_search: 'note_search',
  note_read: 'note_read',
  note_write: 'note_write',
  note_update: 'note_update',
  note_delete: 'note_delete',
};

export function buildNotesTools(options: BuildNotesToolsOptions): HostToolDefinition[] {
  if (!options.enabled) {
    return [];
  }
  const searchOptions: SearchNotesOptions = {};
  if (options.embeddingProvider) {
    searchOptions.embeddingProvider = options.embeddingProvider;
  }
  if (options.rrfK !== undefined) {
    searchOptions.rrfK = options.rrfK;
  }
  const bare = createNotesToolDefinitions(options.store, options.index, searchOptions);
  return bare.map((tool) => wrapNotesToolWithPermission(tool, options.requestPermission));
}

function createNotesToolDefinitions(
  store: NoteStore,
  index: NoteIndex,
  searchOptions: SearchNotesOptions,
): HostToolDefinition[] {
  return [
    {
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
        const hits = await searchNotes(index, query, searchOptions);
        return JSON.stringify(
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
        );
      },
    },
    {
      name: 'note_list',
      description: 'List notes (id, title, collection, tags), newest first.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
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
        return JSON.stringify(
          records.map((record) => ({
            id: record.id,
            title: record.title,
            collection: record.collection,
            tags: record.tags,
            updatedAt: record.updatedAt,
          })),
          null,
          2,
        );
      },
    },
    {
      name: 'note_read',
      description: 'Read a full note by id, including markdown content.',
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string' },
        },
        required: ['noteId'],
      },
      async execute(args) {
        const record = await store.read(String(args.noteId ?? ''));
        return JSON.stringify(record, null, 2);
      },
    },
    {
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
      async execute(args) {
        const writeInput: NoteWriteInput = {
          title: String(args.title ?? ''),
          content: String(args.content ?? ''),
        };
        if (typeof args.collection === 'string' && args.collection) {
          writeInput.collection = args.collection;
        }
        if (Array.isArray(args.tags)) {
          const tags = args.tags.filter((item): item is string => typeof item === 'string');
          if (tags.length > 0) writeInput.tags = tags;
        }
        const record = await store.write(writeInput);
        return JSON.stringify(record, null, 2);
      },
    },
    {
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
      async execute(args) {
        const updateInput: NoteUpdateInput = { id: String(args.noteId ?? '') };
        if (typeof args.title === 'string') updateInput.title = args.title;
        if (typeof args.content === 'string') updateInput.content = args.content;
        if (Array.isArray(args.tags)) {
          updateInput.tags = args.tags.filter((item): item is string => typeof item === 'string');
        }
        const record = await store.update(updateInput);
        return JSON.stringify(record, null, 2);
      },
    },
    {
      name: 'note_delete',
      description: 'Delete a note by id.',
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string' },
        },
        required: ['noteId'],
      },
      async execute(args) {
        const result = await store.delete(String(args.noteId ?? ''));
        return JSON.stringify(result, null, 2);
      },
    },
  ];
}

function wrapNotesToolWithPermission(
  tool: HostToolDefinition,
  requestPermission?: ToolPermissionGate,
): HostToolDefinition {
  const action = NOTES_TOOL_ACTIONS[tool.name];
  if (!action) {
    return tool;
  }
  return {
    ...tool,
    async execute(args, signal) {
      const detail =
        typeof args.noteId === 'string'
          ? args.noteId
          : typeof args.query === 'string'
            ? args.query
            : typeof args.content === 'string'
              ? String(args.content).slice(0, 120)
              : tool.name;
      const evaluation = evaluateNotesPermission(action, detail);
      let decision: PermissionDecision = evaluation.decision;
      if (decision === 'ask') {
        if (requestPermission) {
          decision = await requestPermission({
            action: `notes:${action}`,
            detail,
            defaultDecision: 'ask',
          });
        } else {
          decision = resolveNonInteractiveDecision(evaluation);
        }
      }
      if (decision !== 'allow') {
        throw new Error(
          `Permission ${decision} for ${action}: ${evaluation.reason} (${detail.slice(0, 120)})`,
        );
      }
      return tool.execute(args, signal);
    },
  };
}
