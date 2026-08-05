/**
 * Host IPC handlers for notes, flashcards, and folder-sourced document cards.
 *
 * These commands share lazy application services, but the services remain
 * owned and composed by HostRuntime. This module only translates IPC input
 * into application operations and response payloads.
 */

import { join } from 'node:path';
import type { HostCommand, HostResponse, PiwinConfig } from '@piwin/contracts';
import {
  buildReviewQueue,
  buildFlashcardBatchArtifactHtml,
  exportCardsToTsv,
  type CardStore,
} from '@piwin/flashcards';
import { canonicalizeFolderPath, isPathConfined, type FolderRag } from '@piwin/doc-rag';
import {
  loadGoldenSet,
  runRecallEval,
  searchNotes,
  type NoteIndex,
  type NoteStore,
  type SearchNotesOptions,
} from '@piwin/notes';
import { fail, ok } from '../response-helpers.js';

export type KnowledgeCommandContext = {
  getNotesServices: () => Promise<{
    store: NoteStore;
    index: NoteIndex;
    searchOptions: SearchNotesOptions;
  }>;
  getCardStore: () => Promise<CardStore>;
  getFolderRag: () => Promise<FolderRag>;
  loadConfig: () => Promise<PiwinConfig>;
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
]);

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
      const services = await context.getNotesServices();
      const hits = await searchNotes(services.index, command.query, services.searchOptions);
      return ok(requestId, 'notes/search', { hits });
    }
    case 'notes/write': {
      const { store } = await context.getNotesServices();
      const record = await store.write(command.input);
      return ok(requestId, 'notes/write', { record });
    }
    case 'notes/update': {
      const { store } = await context.getNotesServices();
      const record = await store.update(command.input);
      return ok(requestId, 'notes/update', { record });
    }
    case 'notes/delete': {
      const { store } = await context.getNotesServices();
      const result = await store.delete(command.noteId);
      return ok(requestId, 'notes/delete', result);
    }
    case 'notes/reindex': {
      const { index } = await context.getNotesServices();
      await index.rebuild();
      return ok(requestId, 'notes/reindex', { rebuilt: true });
    }
    case 'notes/eval-run': {
      const services = await context.getNotesServices();
      const { cases, warnings } = await loadGoldenSet(services.store.getNotesRoot());
      if (cases.length === 0) {
        return fail(
          requestId,
          'notes/eval-run',
          'Golden set empty. Pin cases first (piwin notes pin / search result pin).',
        );
      }
      const k = command.k && command.k > 0 ? Math.floor(command.k) : 5;
      const modes: Array<'fts' | 'vector' | 'hybrid'> = services.searchOptions.embeddingProvider
        ? ['fts', 'vector', 'hybrid']
        : ['fts'];
      const reports = [];
      for (const mode of modes) {
        let degraded = false;
        const report = await runRecallEval({
          cases,
          mode,
          k,
          search: async (query, limit, searchMode) =>
            searchNotes(
              services.index,
              { query, limit, mode: searchMode },
              { ...services.searchOptions, onWarning: () => (degraded = true) },
            ),
          wasDegraded: () => degraded,
        });
        services.index.saveEvalRun(report);
        reports.push(report);
      }
      return ok(requestId, 'notes/eval-run', { reports, warnings });
    }
    case 'notes/eval-history': {
      const { index } = await context.getNotesServices();
      const runs = index.listEvalRuns();
      return ok(requestId, 'notes/eval-history', { runs });
    }
    case 'flashcards/create': {
      const store = await context.getCardStore();
      const card = await store.create(command.input);
      return ok(requestId, 'flashcards/create', { card });
    }
    case 'flashcards/list': {
      const store = await context.getCardStore();
      const filter: { deck?: string; sourceNoteId?: string; sourceFolder?: string } = {};
      if (command.deck) filter.deck = command.deck;
      if (command.sourceNoteId) filter.sourceNoteId = command.sourceNoteId;
      if (command.sourceFolder) filter.sourceFolder = command.sourceFolder;
      const cards = await store.list(filter);
      return ok(requestId, 'flashcards/list', { cards });
    }
    case 'flashcards/batch-create': {
      const store = await context.getCardStore();
      const config = await context.loadConfig();
      const maxBatchSize = config.flashcards?.maxBatchSize ?? 40;
      const result = await store.batchCreate(command.input, maxBatchSize);
      const artifactHtml = buildFlashcardBatchArtifactHtml(result.created);
      return ok(requestId, 'flashcards/batch-create', { ...result, artifactHtml });
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
      const cards = await store.list();
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
      const cards = await store.list(command.deck ? { deck: command.deck } : undefined);
      return ok(requestId, 'flashcards/export', {
        tsv: exportCardsToTsv(cards),
        count: cards.length,
      });
    }
    case 'doccards/scan-folder': {
      const rag = await context.getFolderRag();
      const result = await rag.scanFolder(command.folderPath);
      return ok(requestId, 'doccards/scan-folder', result);
    }
    case 'doccards/index-folder': {
      const rag = await context.getFolderRag();
      const result = await rag.indexFolder(
        command.folderPath,
        command.includeFiles ? { includeFiles: command.includeFiles } : undefined,
      );
      return ok(requestId, 'doccards/index-folder', result);
    }
    case 'doccards/retrieve': {
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
      const store = await context.getCardStore();
      const canonical = await canonicalizeFolderPath(command.folderPath);
      const result = await store.deleteBySourceFolder(canonical ?? command.folderPath);
      return ok(requestId, 'doccards/forget-folder', result);
    }
    case 'doccards/open-source': {
      const store = await context.getCardStore();
      const card = await store.read(command.cardId);
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
