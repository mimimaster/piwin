/**
 * Host customTools for the notes library (ADR 0018).
 * Pure tool descriptors; permission gate wraps execute at registration.
 */
import type {
  HostToolPermissionSpec,
  HostToolRegistration,
  NoteUpdateInput,
  NoteWriteInput,
  ToolResult,
} from '@piwin/contracts';
import { HEALTH_MODEL_OUTPUT_PREAMBLE, isHealthSensitiveToolResult } from '@piwin/contracts';
import type { FolderRag } from '@piwin/doc-rag';
import type { NoteStore } from '@piwin/notes';
import type { NotesPermissionAction } from './permission-policy.js';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import {
  deleteNoteAndReindex,
  updateNoteAndReindex,
  writeNoteAndReindex,
} from './notes-write-service.js';

export type BuildNotesToolsOptions = {
  store: NoteStore;
  rag: FolderRag;
  piwinRoot?: string;
  /** When false, returns no tools. */
  enabled: boolean;
  /**
   * When true, only return read-only tools (note_list, note_read).
   * Used by the knowledge tool profile (doc-flashcards §10.2).
   */
  readOnly?: boolean;
  /**
   * When false, omit note_list / note_read so knowledge_* tools
   * are the only retrieval surface.
   */
  includeReadTools?: boolean;
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
  const writeDeps = {
    store: options.store,
    rag: options.rag,
    ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
  };
  const bare = createNotesToolDefinitions(writeDeps);
  const filtered = options.readOnly
    ? bare.filter(
        (tool) =>
          tool.descriptor.name === 'note_list' ||
          tool.descriptor.name === 'note_read',
      )
    : options.includeReadTools === false
      ? bare.filter(
          (tool) =>
            tool.descriptor.name !== 'note_list' &&
            tool.descriptor.name !== 'note_read',
        )
      : bare;
  return filtered;
}

function createNotesToolDefinitions(
  deps: { store: NoteStore; rag: FolderRag; piwinRoot?: string },
): HostToolRegistration[] {
  const store = deps.store;
  return [
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
        const result = await writeNoteAndReindex(deps, writeInput);
        const output = result.indexed
          ? JSON.stringify(result.record, null, 2)
          : `${JSON.stringify(result.record, null, 2)}\nIndexing failed: ${result.indexError ?? 'unknown error'}`;
        return {
          ok: true,
          output,
          details: {
            noteId: result.record.id,
            indexed: result.indexed,
            ...(result.indexError !== undefined ? { indexError: result.indexError } : {}),
          },
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
        const result = await updateNoteAndReindex(deps, updateInput);
        const output = result.indexed
          ? JSON.stringify(result.record, null, 2)
          : `${JSON.stringify(result.record, null, 2)}\nIndexing failed: ${result.indexError ?? 'unknown error'}`;
        return {
          ok: true,
          output,
          details: {
            noteId,
            indexed: result.indexed,
            ...(result.indexError !== undefined ? { indexError: result.indexError } : {}),
          },
        };
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
        const result = await deleteNoteAndReindex(deps, noteId);
        const output = result.unindexed
          ? JSON.stringify({ deleted: result.deleted, id: result.id }, null, 2)
          : `${JSON.stringify({ deleted: result.deleted, id: result.id }, null, 2)}\nIndex cleanup failed: ${result.indexError ?? 'unknown error'}`;
        return {
          ok: true,
          output,
          details: {
            noteId,
            unindexed: result.unindexed,
            ...(result.indexError !== undefined ? { indexError: result.indexError } : {}),
          },
        };
      },
    },
  ];
}
