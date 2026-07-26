export { createNoteStore } from './note-store.js';
export type { NoteStore, NoteStoreOptions, ScannedNote } from './note-store.js';
export { openNoteIndex } from './note-index.js';
export type { NoteIndex } from './note-index.js';
export { searchNotes } from './search-notes.js';
export { tokenize, tokenizeForIndex, buildMatchExpression } from './tokenize.js';
export { encodeNoteMarkdown, decodeNoteMarkdown } from './markdown-codec.js';
export {
  getNotesRoot,
  getIndexPath,
  assertInsideNotesRoot,
  DEFAULT_COLLECTION,
} from './paths.js';
