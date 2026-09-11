/**
 * Write a note file, then reindex (or forget) it in FolderRag.
 * File success is never masked by an indexing failure.
 */
import type { NoteRecord, NoteUpdateInput, NoteWriteInput } from '@piwin/contracts';
import type { FolderRag } from '@piwin/doc-rag';
import { getNotesRoot, type NoteStore } from '@piwin/notes';
import { getPiwinRoot } from './paths.js';

export type NotesWriteDeps = { store: NoteStore; rag: FolderRag; piwinRoot?: string };

export type NoteWriteReindexResult = {
  record: NoteRecord;
  indexed: boolean;
  indexError?: string;
};

export type NoteDeleteReindexResult = {
  deleted: true;
  id: string;
  unindexed: boolean;
  indexError?: string;
};

export async function writeNoteAndReindex(
  deps: NotesWriteDeps,
  input: NoteWriteInput,
): Promise<NoteWriteReindexResult> {
  const record = await deps.store.write(input);
  return reindexRecord(deps, record);
}

export async function updateNoteAndReindex(
  deps: NotesWriteDeps,
  input: NoteUpdateInput,
): Promise<NoteWriteReindexResult> {
  const record = await deps.store.update(input);
  return reindexRecord(deps, record);
}

export async function deleteNoteAndReindex(
  deps: NotesWriteDeps,
  noteId: string,
  expectedContentHash?: string,
): Promise<NoteDeleteReindexResult> {
  const existing = await deps.store.read(noteId);
  const result = await deps.store.delete(noteId, expectedContentHash);
  try {
    await deps.rag.forgetFile(notesRootOf(deps), existing.relativePath);
    return { ...result, unindexed: true };
  } catch (error) {
    return { ...result, unindexed: false, indexError: errorMessage(error) };
  }
}

async function reindexRecord(
  deps: NotesWriteDeps,
  record: NoteRecord,
): Promise<NoteWriteReindexResult> {
  try {
    const ingested = await deps.rag.ingestFile(notesRootOf(deps), record.relativePath);
    if (ingested.status === 'FAILED') {
      return { record, indexed: false, indexError: ingested.error ?? 'FAILED' };
    }
    return { record, indexed: true };
  } catch (error) {
    return { record, indexed: false, indexError: errorMessage(error) };
  }
}

function notesRootOf(deps: NotesWriteDeps): string {
  return getNotesRoot(getPiwinRoot(deps.piwinRoot));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
