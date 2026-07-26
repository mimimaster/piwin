import type { NoteSearchHit, NoteSearchQuery } from '@piwin/contracts';
import type { NoteIndex } from './note-index.js';

/**
 * Search entry point: lazy reconcile then FTS.
 * Vector/hybrid modes arrive with the embedding slice (S3); until then all
 * modes serve FTS results so callers can pass mode freely.
 */
export async function searchNotes(
  index: NoteIndex,
  query: NoteSearchQuery,
): Promise<NoteSearchHit[]> {
  await index.reconcile();
  return index.searchFts(query);
}
