/**
 * Host IPC handlers for notes, flashcards, and folder-sourced document cards.
 *
 * These commands share lazy application services, but the services remain
 * owned and composed by HostRuntime. This module only translates IPC input
 * into application operations and response payloads.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostCommand, HostResponse, PiwinConfig } from '@piwin/contracts';
import { NOTES_KNOWLEDGE_BASE_ID } from '@piwin/contracts';
import {
  buildReviewQueue,
  displayCardsFromBatchResult,
  exportCardsToTsv,
  parseReviewCardId,
  type CardStore,
} from '@piwin/flashcards';
import { canonicalizeFolderPath, isPathConfined, type FolderRag } from '@piwin/doc-rag';
import { NoteRevisionConflictError, getNotesRoot, type NoteStore } from '@piwin/notes';
import { getPiwinRoot } from '../paths.js';
import {
  deleteNoteAndReindex,
  updateNoteAndReindex,
  writeNoteAndReindex,
} from '../notes-write-service.js';
import { searchKnowledgeBases } from '../knowledge-retriever.js';
import { fail, ok } from '../response-helpers.js';
import {
  handleKnowledgeBaseCommand,
  knowledgeRuntimeFromContext,
  publishKnowledgeBasesChanged,
} from './knowledge-base-commands.js';
import type { CompleteJsonFn, DraftCardsFn } from '@piwin/doc-rag';
import type { DoccardsIngestionRegistry } from './doccards-job-commands.js';
import type { DoccardsGenerationRegistry } from './doccards-generation-jobs.js';
import type { HostPush } from '@piwin/contracts';

export type KnowledgeCommandContext = {
  getNotesServices: () => Promise<{
    store: NoteStore;
  }>;
  getCardStore: () => Promise<CardStore>;
  getFolderRag: () => Promise<FolderRag>;
  loadConfig: () => Promise<PiwinConfig>;
  push?: (message: HostPush) => void;
  ingestionJobs?: DoccardsIngestionRegistry;
  generationJobs?: DoccardsGenerationRegistry;
  draftCards?: DraftCardsFn;
  completeJson?: CompleteJsonFn;
  openReviewSession?: (input: {
    workspaceName: string;
    topic: string;
    sequenceId: string;
    generationId: string;
    cardIds: string[];
  }) => Promise<{ sessionId: string }>;
  piwinRoot?: string;
};

const TYPES = new Set<HostCommand['type']>([
  'notes/list',
  'notes/read',
  'notes/search',
  'notes/write',
  'notes/update',
  'notes/delete',
  'notes/reindex',
  'notes/eval-run',
  'notes/eval-history',
  'flashcards/create',
  'flashcards/list',
  'flashcards/batch-create',
  'flashcards/delete',
  'flashcards/decks',
  'flashcards/queue',
  'flashcards/rate',
  'flashcards/export',
  'doccards/scan-folder',
  'doccards/index-folder',
  'doccards/retrieve',
  'doccards/list-by-folder',
  'doccards/rebind-folder',
  'doccards/forget-folder',
  'doccards/open-source',
  'doccards/index-status',
  'doccards/cancel-index',
  'doccards/generate',
  'doccards/generation-status',
  'doccards/cancel-generation',
  'knowledge/bases/list',
  'knowledge/bases/add',
  'knowledge/bases/rename',
  'knowledge/bases/remove',
  'knowledge/search',
  'knowledge/open-source',
  'session/set-knowledge-bases',
]);

/** One notes rebuild at a time for this Host process. */
let notesReindexInFlight: Promise<unknown> | undefined;

export function isKnowledgeCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleKnowledgeCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: KnowledgeCommandContext | undefined,
): Promise<HostResponse | null> {
  if (!isKnowledgeCommand(command)) return null;
  if (!context) {
    return fail(requestId, command.type, 'knowledge services are not available in this host mode');
  }

  const knowledgeBase = await handleKnowledgeBaseCommand(command, requestId, context);
  if (knowledgeBase) return knowledgeBase;

  switch (command.type) {
    case 'notes/list': {
      const { store } = await context.getNotesServices();
      const filter: { collection?: string; tags?: string[] } = {};
      if (command.collection) filter.collection = command.collection;
      if (command.tags && command.tags.length > 0) filter.tags = command.tags;
      const records = await store.list(filter);
      return ok(requestId, 'notes/list', { records });
    }
    case 'notes/read': {
      const { store } = await context.getNotesServices();
      const record = await store.read(command.noteId);
      return ok(requestId, 'notes/read', { record });
    }
    case 'notes/search': {
      const result = await searchKnowledgeBases(knowledgeRuntimeFromContext(context), {
        query: command.query.query,
        baseIds: [NOTES_KNOWLEDGE_BASE_ID],
        ...(command.query.limit !== undefined ? { limit: command.query.limit } : {}),
        ...(command.query.tags && command.query.tags.length > 0 ? { tags: command.query.tags } : {}),
      });
      return ok(requestId, 'notes/search', {
        hits: result.citations.map((citation) => ({
          note: {
            id: citation.noteId ?? '',
            // note-store.ts lays files out as `<collection>/<id>.md`, so the
            // first relativePath segment is the real collection; fall back
            // to 'default' for a legacy/external file with no subfolder.
            collection: citation.relativePath?.includes('/')
              ? citation.relativePath.split('/')[0]
              : 'default',
            title: citation.title,
            content: citation.text,
            createdAt: '',
            updatedAt: '',
            relativePath: citation.relativePath ?? '',
            contentHash: '',
            ...(typeof citation.metadata?.tags !== 'undefined' && Array.isArray(citation.metadata.tags)
              ? {
                  tags: citation.metadata.tags.filter((tag): tag is string => typeof tag === 'string'),
                }
              : {}),
          },
          score: citation.score ?? 0,
          snippet: citation.text,
          channels: ['fts'],
          rank: {},
        })),
        citations: result.citations,
        degradedBaseIds: result.degradedBaseIds,
        skipped: result.skipped,
      });
    }
    case 'notes/write': {
      const { store } = await context.getNotesServices();
      const rag = await context.getFolderRag();
      const result = await writeNoteAndReindex(notesWriteDeps(context, store, rag), command.input);
      await publishKnowledgeBasesChanged(context);
      return ok(requestId, 'notes/write', result);
    }
    case 'notes/update': {
      const { store } = await context.getNotesServices();
      const rag = await context.getFolderRag();
      try {
        const result = await updateNoteAndReindex(
          notesWriteDeps(context, store, rag),
          command.input,
        );
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, 'notes/update', result);
      } catch (error) {
        if (error instanceof NoteRevisionConflictError) {
          return fail(requestId, 'notes/update', 'notes-revision-conflict', {
            code: 'notes-revision-conflict',
            data: {
              noteId: error.noteId,
              ...(error.actualContentHash === undefined
                ? {}
                : { actualContentHash: error.actualContentHash }),
            },
          });
        }
        throw error;
      }
    }
    case 'notes/delete': {
      const { store } = await context.getNotesServices();
      const rag = await context.getFolderRag();
      try {
        const result = await deleteNoteAndReindex(
          notesWriteDeps(context, store, rag),
          command.noteId,
          command.expectedContentHash,
        );
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, 'notes/delete', result);
      } catch (error) {
        if (error instanceof NoteRevisionConflictError) {
          return fail(requestId, 'notes/delete', 'notes-revision-conflict', {
            code: 'notes-revision-conflict',
            data: {
              noteId: error.noteId,
              ...(error.actualContentHash === undefined
                ? {}
                : { actualContentHash: error.actualContentHash }),
            },
          });
        }
        throw error;
      }
    }
    case 'notes/reindex': {
      const rag = await context.getFolderRag();
      const notesRoot = getNotesRoot(getPiwinRoot(context.piwinRoot));
      await mkdir(notesRoot, { recursive: true });
      if (notesReindexInFlight === undefined) {
        notesReindexInFlight = rag.indexFolder(notesRoot).finally(() => {
          notesReindexInFlight = undefined;
        });
      }
      await notesReindexInFlight;
      return ok(requestId, 'notes/reindex', { rebuilt: true });
    }
    case 'notes/eval-run': {
      return fail(
        requestId,
        'notes/eval-run',
        'Notes recall eval against doc-rag is not ported yet. Use `piwin kb search` to inspect retrieval.',
      );
    }
    case 'notes/eval-history': {
      return ok(requestId, 'notes/eval-history', { runs: [] });
    }
    case 'flashcards/create': {
      const store = await context.getCardStore();
      const card = await store.create(command.input);
      return ok(requestId, 'flashcards/create', { card });
    }
    case 'flashcards/list': {
      const store = await context.getCardStore();
      const filter: {
        deck?: string;
        sourceNoteId?: string;
        sourceFolder?: string;
        sequenceId?: string;
      } = {};
      if (command.deck) filter.deck = command.deck;
      if (command.sourceNoteId) filter.sourceNoteId = command.sourceNoteId;
      if (command.sourceFolder) filter.sourceFolder = command.sourceFolder;
      if (command.sequenceId) filter.sequenceId = command.sequenceId;
      const cards = await store.list(filter);
      return ok(requestId, 'flashcards/list', { cards });
    }
    case 'flashcards/batch-create': {
      const store = await context.getCardStore();
      const config = await context.loadConfig();
      const maxBatchSize = config.flashcards?.maxBatchSize ?? 40;
      const result = await store.batchCreate(command.input, maxBatchSize);
      const display = { cards: displayCardsFromBatchResult(result) };
      return ok(requestId, 'flashcards/batch-create', { ...result, display });
    }
    case 'flashcards/delete': {
      const store = await context.getCardStore();
      const result = await store.delete(command.cardId);
      return ok(requestId, 'flashcards/delete', result);
    }
    case 'flashcards/decks': {
      const store = await context.getCardStore();
      const decks = await store.listDecks();
      return ok(requestId, 'flashcards/decks', { decks });
    }
    case 'flashcards/queue': {
      const store = await context.getCardStore();
      const config = await context.loadConfig();
      const cards = await store.listReviewCards();
      const states = await store.loadReviewStates();
      const queue = buildReviewQueue({
        cards,
        states,
        ...(command.deck ? { deck: command.deck } : {}),
        ...(typeof config.flashcards?.newPerDay === 'number'
          ? { newPerDay: config.flashcards.newPerDay }
          : {}),
        ...(typeof config.flashcards?.maxReviewsPerDay === 'number'
          ? { maxReviewsPerDay: config.flashcards.maxReviewsPerDay }
          : {}),
      });
      return ok(requestId, 'flashcards/queue', { queue });
    }
    case 'flashcards/rate': {
      const store = await context.getCardStore();
      const state = await store.rate(command.cardId, command.rating);
      return ok(requestId, 'flashcards/rate', { state });
    }
    case 'flashcards/export': {
      const store = await context.getCardStore();
      const cards = await store.listReviewCards(command.deck ? { deck: command.deck } : undefined);
      return ok(requestId, 'flashcards/export', {
        tsv: exportCardsToTsv(cards),
        count: cards.length,
      });
    }
    case 'doccards/scan-folder': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return fail(requestId, 'doccards/scan-folder', 'folderPath is required');
      }
      const rag = await context.getFolderRag();
      const result = await rag.scanFolder(command.folderPath);
      return ok(requestId, 'doccards/scan-folder', result);
    }
    case 'doccards/index-folder': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return fail(requestId, 'doccards/index-folder', 'folderPath is required');
      }
      if (!context.ingestionJobs) {
        return fail(requestId, 'doccards/index-folder', 'ingestion jobs are not available');
      }
      const rag = await context.getFolderRag();
      const started = await context.ingestionJobs.startIndex({
        folderPath: command.folderPath,
        ...(command.includeFiles ? { includeFiles: command.includeFiles } : {}),
        rag,
        ...(context.push ? { push: context.push } : {}),
        ...(context.generationJobs
          ? { isGenerationRunning: (key) => context.generationJobs!.isRunning(key) }
          : {}),
      });
      if ('error' in started) {
        return fail(requestId, 'doccards/index-folder', started.error);
      }
      return ok(requestId, 'doccards/index-folder', started.accepted);
    }
    case 'doccards/index-status': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return fail(requestId, 'doccards/index-status', 'folderPath is required');
      }
      if (!context.ingestionJobs) {
        return fail(requestId, 'doccards/index-status', 'ingestion jobs are not available');
      }
      const job = await context.ingestionJobs.status(command.folderPath);
      const rag = await context.getFolderRag();
      const documents = await rag.listDocuments(command.folderPath);
      return ok(requestId, 'doccards/index-status', { job: job ?? null, documents });
    }
    case 'doccards/cancel-index': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return fail(requestId, 'doccards/cancel-index', 'folderPath is required');
      }
      if (!context.ingestionJobs) {
        return fail(requestId, 'doccards/cancel-index', 'ingestion jobs are not available');
      }
      const result = await context.ingestionJobs.cancel(command.folderPath);
      if ('error' in result) {
        return fail(requestId, 'doccards/cancel-index', result.error);
      }
      return ok(requestId, 'doccards/cancel-index', { job: result });
    }
    case 'doccards/generate': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return fail(requestId, 'doccards/generate', 'folderPath is required');
      }
      if (!context.generationJobs || (!context.draftCards && !context.completeJson)) {
        return fail(requestId, 'doccards/generate', 'GENERATION_MODEL_NOT_CONFIGURED');
      }
      const rag = await context.getFolderRag();
      const cardStore = await context.getCardStore();
      const started = await context.generationJobs.startGenerate({
        folderPath: command.folderPath,
        ...(command.includeFiles ? { includeFiles: command.includeFiles } : {}),
        ...(command.topic ? { topic: command.topic } : {}),
        ...(command.deck ? { deck: command.deck } : {}),
        rag,
        cardStore,
        ...(context.draftCards ? { draftCards: context.draftCards } : {}),
        ...(context.completeJson ? { completeJson: context.completeJson } : {}),
        ...(context.piwinRoot ? { piwinRoot: context.piwinRoot } : {}),
        ...(context.push ? { push: context.push } : {}),
        isIndexRunning: (key) => context.ingestionJobs?.isRunning(key) === true,
        ...(context.openReviewSession ? { openReviewSession: context.openReviewSession } : {}),
      });
      if ('error' in started) {
        return fail(requestId, 'doccards/generate', started.error);
      }
      return ok(requestId, 'doccards/generate', started.accepted);
    }
    case 'doccards/generation-status': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return fail(requestId, 'doccards/generation-status', 'folderPath is required');
      }
      if (!context.generationJobs) {
        return fail(requestId, 'doccards/generation-status', 'generation jobs are not available');
      }
      const job = await context.generationJobs.status(command.folderPath);
      return ok(requestId, 'doccards/generation-status', { job: job ?? null });
    }
    case 'doccards/cancel-generation': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return fail(requestId, 'doccards/cancel-generation', 'folderPath is required');
      }
      if (!context.generationJobs) {
        return fail(requestId, 'doccards/cancel-generation', 'generation jobs are not available');
      }
      const result = await context.generationJobs.cancel(command.folderPath);
      if ('error' in result) {
        return fail(requestId, 'doccards/cancel-generation', result.error);
      }
      return ok(requestId, 'doccards/cancel-generation', { job: result });
    }
    case 'doccards/retrieve': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return fail(requestId, 'doccards/retrieve', 'folderPath is required');
      }
      const rag = await context.getFolderRag();
      const canonical = await canonicalizeFolderPath(command.folderPath);
      const chunks = await rag.retrieve(command.folderPath, command.query, {
        ...(command.limit !== undefined ? { limit: command.limit } : {}),
        ...(command.fileAllowlist ? { fileAllowlist: command.fileAllowlist } : {}),
        ...(command.maxTotalChars !== undefined ? { maxTotalChars: command.maxTotalChars } : {}),
      });
      return ok(requestId, 'doccards/retrieve', {
        chunks,
        canonicalPath: canonical ?? command.folderPath,
        degraded: !rag.hasEmbeddingProvider,
      });
    }
    case 'doccards/list-by-folder': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return ok(requestId, 'doccards/list-by-folder', {
          records: [],
          folderExists: false,
          canonicalPath: '',
        });
      }
      const store = await context.getCardStore();
      const canonical = await canonicalizeFolderPath(command.folderPath);
      const records = await store.list(
        canonical ? { sourceFolder: canonical } : { sourceFolder: command.folderPath },
      );
      return ok(requestId, 'doccards/list-by-folder', {
        records,
        folderExists: canonical !== null,
        canonicalPath: canonical ?? command.folderPath,
      });
    }
    case 'doccards/rebind-folder': {
      const store = await context.getCardStore();
      const oldCanonical = await canonicalizeFolderPath(command.oldPath);
      const newCanonical = await canonicalizeFolderPath(command.newPath);
      const result = await store.rebindSourceFolder(
        oldCanonical ?? command.oldPath,
        newCanonical ?? command.newPath,
      );
      return ok(requestId, 'doccards/rebind-folder', result);
    }
    case 'doccards/forget-folder': {
      if (
        !command.folderPath ||
        typeof command.folderPath !== 'string' ||
        !command.folderPath.trim()
      ) {
        return fail(requestId, 'doccards/forget-folder', 'folderPath is required');
      }
      const store = await context.getCardStore();
      const canonical = await canonicalizeFolderPath(command.folderPath);
      const result = await store.deleteBySourceFolder(canonical ?? command.folderPath);
      return ok(requestId, 'doccards/forget-folder', result);
    }
    case 'doccards/open-source': {
      const store = await context.getCardStore();
      const card = await store.read(parseReviewCardId(command.cardId).itemId);
      if (!card.sourceFolder || !card.sourceFile) {
        throw new Error('Card has no folder source attribution');
      }
      const canonical = await canonicalizeFolderPath(card.sourceFolder);
      if (!canonical) {
        throw new Error(`Source folder no longer exists: ${card.sourceFolder}`);
      }
      if (!(await isPathConfined(canonical, card.sourceFile))) {
        throw new Error('Source file path is not confined to the folder');
      }
      const absolutePath = join(canonical, card.sourceFile);
      return ok(requestId, 'doccards/open-source', { opened: true, path: absolutePath });
    }
    default:
      return null;
  }
}

function notesWriteDeps(
  context: KnowledgeCommandContext,
  store: NoteStore,
  rag: FolderRag,
): { store: NoteStore; rag: FolderRag; piwinRoot?: string } {
  return {
    store,
    rag,
    ...(context.piwinRoot !== undefined ? { piwinRoot: context.piwinRoot } : {}),
  };
}
