/** Notes / flashcards / doccards HostCommand variants, including study commands. */

import type {
  FlashcardBatchCreateInput,
  FlashcardCreateInput,
  ReviewRating,
} from './flashcards.js';
import type { FlashcardStudyHostCommand } from './flashcard-study-commands.js';
import type { IndexFolderOptions, RetrieveOptions } from './doc-rag.js';
import type { KnowledgeBaseHostCommand } from './knowledge-base.js';
import type {
  NoteSearchQuery,
  NoteUpdateInput,
  NoteWriteInput,
} from './notes.js';

/** Knowledge-plane commands (notes, flashcards, folder-sourced cards). */
export type KnowledgeHostCommand =
  /** Notes library (ADR 0018): CRUD + hybrid search + recall eval. */
  | { id?: string; type: 'notes/list'; collection?: string; tags?: string[] }
  | { id?: string; type: 'notes/read'; noteId: string }
  | { id?: string; type: 'notes/search'; query: NoteSearchQuery }
  | { id?: string; type: 'notes/write'; input: NoteWriteInput }
  | { id?: string; type: 'notes/update'; input: NoteUpdateInput }
  | { id?: string; type: 'notes/delete'; noteId: string; expectedContentHash?: string }
  | { id?: string; type: 'notes/reindex' }
  | { id?: string; type: 'notes/eval-run'; k?: number }
  | { id?: string; type: 'notes/eval-history' }
  /** Flashcards (ADR 0018): CRUD + FSRS review, incl. artifact rate actions. */
  | { id?: string; type: 'flashcards/create'; input: FlashcardCreateInput }
  | {
      id?: string;
      type: 'flashcards/list';
      deck?: string;
      sourceNoteId?: string;
      sourceFolder?: string;
      sequenceId?: string;
    }
  | { id?: string; type: 'flashcards/delete'; cardId: string }
  | { id?: string; type: 'flashcards/decks' }
  | { id?: string; type: 'flashcards/queue'; deck?: string }
  | { id?: string; type: 'flashcards/rate'; cardId: string; rating: ReviewRating }
  | { id?: string; type: 'flashcards/export'; deck?: string }
  | { id?: string; type: 'flashcards/batch-create'; input: FlashcardBatchCreateInput }
  /** Doc Cards (folder-sourced flashcards): scan / index / retrieve / bind. See docs/specs/doc-flashcards.md. */
  | { id?: string; type: 'doccards/scan-folder'; folderPath: string }
  | ({
      id?: string;
      type: 'doccards/index-folder';
      folderPath: string;
    } & Omit<IndexFolderOptions, 'signal'>)
  | ({
      id?: string;
      type: 'doccards/retrieve';
      folderPath: string;
      query: string;
    } & Omit<RetrieveOptions, 'signal' | 'embeddingProvider'>)
  | { id?: string; type: 'doccards/list-by-folder'; folderPath: string }
  | { id?: string; type: 'doccards/rebind-folder'; oldPath: string; newPath: string }
  | { id?: string; type: 'doccards/forget-folder'; folderPath: string }
  | { id?: string; type: 'doccards/open-source'; cardId: string; openFile?: boolean }
  | { id?: string; type: 'doccards/index-status'; folderPath: string }
  | { id?: string; type: 'doccards/cancel-index'; folderPath: string }
  | {
      id?: string;
      type: 'doccards/generate';
      folderPath: string;
      includeFiles?: string[];
      topic?: string;
      difficulty?: 'easy' | 'medium' | 'hard';
      density?: 'concise' | 'standard' | 'detailed';
      deck?: string;
    }
  | { id?: string; type: 'doccards/generation-status'; folderPath: string }
  | { id?: string; type: 'doccards/cancel-generation'; folderPath: string }
  | FlashcardStudyHostCommand
  /** Unified knowledge base registry, search, and session mounts. */
  | KnowledgeBaseHostCommand;
