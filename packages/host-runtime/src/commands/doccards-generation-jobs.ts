/**
 * P4 generation job: retrieve V2 → single-pass cards → CardStore.
 * Persist lives here so @piwin/doc-rag stays free of @piwin/flashcards.
 */
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { ContextPack, GeneratedFlashcard, GenerationJob, HostPush } from '@piwin/contracts';
import type { CardStore } from '@piwin/flashcards';
import {
  assignPositions,
  canonicalizeFolderPath,
  FLASHCARD_QUALITY_RULES,
  folderKey,
  toFlashcardCreateInputs,
  writeGenerationRecord,
  type DraftCardsFn,
  type FolderRag,
} from '@piwin/doc-rag';
import { getFlashcardsRoot } from '@piwin/flashcards';
import { getPiwinRoot } from '../paths.js';

const PERSIST_BATCH_SIZE = 40;
const TERMINAL_GENERATION = new Set(['COMPLETED', 'COMPLETED_DEGRADED', 'FAILED', 'CANCELED']);

async function persistGeneratedCards(input: {
  cards: GeneratedFlashcard[];
  cardStore: CardStore;
  folderPath: string;
  generationId: string;
  sequenceId: string;
  deck: string;
  pack: ContextPack;
}): Promise<{ created: string[]; skipped: number }> {
  const cards = toFlashcardCreateInputs(input);
  const created: string[] = [];
  let skipped = 0;
  for (let offset = 0; offset < cards.length; offset += PERSIST_BATCH_SIZE) {
    const result = await input.cardStore.batchCreate({
      cards: cards.slice(offset, offset + PERSIST_BATCH_SIZE),
    });
    created.push(...result.created.map((card) => card.id));
    skipped += result.skipped.length;
  }
  return { created, skipped };
}

export type DoccardsGenerationRegistry = {
  startGenerate: (input: {
    folderPath: string;
    includeFiles?: string[];
    topic?: string;
    deck?: string;
    rag: FolderRag;
    cardStore: CardStore;
    draftCards: DraftCardsFn;
    piwinRoot?: string;
    push?: (message: HostPush) => void;
    isIndexRunning: (folderKey: string) => boolean;
  }) => Promise<{ accepted: { generationId: string; status: 'PENDING' | 'RUNNING' } } | { error: string }>;
  status: (folderPath: string) => Promise<GenerationJob | undefined>;
  cancel: (folderPath: string) => Promise<GenerationJob | { error: string }>;
  isRunning: (folderKey: string) => boolean;
};

export function createDoccardsGenerationRegistry(): DoccardsGenerationRegistry {
  const byFolder = new Map<string, GenerationJob>();
  const running = new Map<string, AbortController>();

  function emit(push: ((message: HostPush) => void) | undefined, job: GenerationJob, terminal: boolean): void {
    if (!push) return;
    push(
      terminal
        ? { type: 'doccards/generation-terminal', job, ...(job.sessionId ? { sessionId: job.sessionId } : {}), ...(job.createdCardIds ? { cardIds: job.createdCardIds } : {}) }
        : { type: 'doccards/generation-progress', job },
    );
  }

  return {
    isRunning(folderKeyValue) {
      const job = [...byFolder.values()].find((item) => item.folderKey === folderKeyValue);
      return Boolean(job && !TERMINAL_GENERATION.has(job.status));
    },

    async startGenerate(input) {
      const canonical = await canonicalizeFolderPath(input.folderPath);
      if (!canonical) return { error: `Folder not found: ${input.folderPath}` };
      const key = folderKey(canonical);
      if (input.isIndexRunning(key)) return { error: 'INDEX_RUNNING' };
      if (this.isRunning(key)) return { error: 'GENERATION_RUNNING' };

      const selected = input.includeFiles && input.includeFiles.length > 0
        ? input.includeFiles
        : (await input.rag.scanFolder(canonical)).files.map((file) => file.relativePath);
      if (selected.length === 0) return { error: 'NO_SUPPORTED_FILES' };
      const documents = await input.rag.listDocuments(canonical);
      const ready = new Set(
        documents.filter((doc) => doc.status === 'READY').map((doc) => doc.relativePath),
      );
      if (!selected.every((file) => ready.has(file))) {
        return { error: 'INDEX_NOT_READY' };
      }

      const workspaceName = basename(canonical);
      const topic = input.topic?.trim() || workspaceName;
      const generationId = `gen_${randomUUID()}`;
      const sequenceId = `seq_${generationId}`;
      const now = new Date().toISOString();
      const job: GenerationJob = {
        id: generationId,
        folderKey: key,
        folderPath: canonical,
        workspaceName,
        includeFiles: selected,
        topic,
        status: 'RETRIEVING',
        sequenceId,
        startedAt: now,
      };
      byFolder.set(key, job);
      const abort = new AbortController();
      running.set(key, abort);
      emit(input.push, job, false);

      void (async () => {
        const update = (patch: Partial<GenerationJob>, terminal = false): void => {
          const current = byFolder.get(key);
          if (!current || current.id !== generationId) return;
          if (TERMINAL_GENERATION.has(current.status)) return;
          const next: GenerationJob = {
            ...current,
            ...patch,
            ...(terminal ? { completedAt: patch.completedAt ?? new Date().toISOString() } : {}),
          };
          byFolder.set(key, next);
          emit(input.push, next, terminal);
        };
        try {
          const chunks = await input.rag.retrieve(canonical, topic, {
            fileAllowlist: selected,
            signal: abort.signal,
          });
          if (chunks.length === 0) {
            update({ status: 'FAILED' }, true);
            return;
          }
          update({ status: 'GENERATING_CARDS' });
          const pack = {
            query: topic,
            folderKey: key,
            retrievalMode: 'fts_only' as const,
            degraded: !input.rag.hasEmbeddingProvider,
            sources: chunks.map((chunk, index) => ({
              chunkId: `ret-${index}`,
              documentId: chunk.filePath,
              relativePath: chunk.filePath,
              text: chunk.content,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              retrievedBy: 'fts' as const,
            })),
          };
          const existing = await input.cardStore.list({ sourceFolder: canonical });
          const drafts = assignPositions(
            await input.draftCards({
              topic,
              workspaceName,
              pack,
              existingFronts: existing.map((card) => card.front),
              qualityRules: FLASHCARD_QUALITY_RULES,
            }),
          );
          if (drafts.length === 0) {
            update({ status: 'COMPLETED', created: 0, skipped: 0, createdCardIds: [] }, true);
            return;
          }
          update({ status: 'PERSISTING' });
          const persisted = await persistGeneratedCards({
            cards: drafts,
            cardStore: input.cardStore,
            folderPath: canonical,
            generationId,
            sequenceId,
            deck: input.deck ?? workspaceName,
            pack,
          });
          const flashcardsRoot = getFlashcardsRoot(getPiwinRoot(input.piwinRoot));
          await writeGenerationRecord({
            flashcardsRoot,
            generationId,
            folderKey: key,
            query: topic,
            includeFiles: selected,
            sequenceId,
            createdCardIds: persisted.created,
            retrievalMode: pack.retrievalMode,
            degraded: pack.degraded,
          });
          update(
            {
              status: 'COMPLETED',
              created: persisted.created.length,
              skipped: persisted.skipped,
              createdCardIds: persisted.created,
            },
            true,
          );
        } catch {
          update(
            {
              status: abort.signal.aborted ? 'CANCELED' : 'FAILED',
            },
            true,
          );
        } finally {
          running.delete(key);
        }
      })();

      return { accepted: { generationId, status: 'RUNNING' } };
    },

    async status(folderPath) {
      const canonical = (await canonicalizeFolderPath(folderPath)) ?? folderPath;
      return byFolder.get(folderKey(canonical));
    },

    async cancel(folderPath) {
      const canonical = (await canonicalizeFolderPath(folderPath)) ?? folderPath;
      const key = folderKey(canonical);
      const job = byFolder.get(key);
      if (!job || !this.isRunning(key)) return { error: 'GENERATION_NOT_RUNNING' };
      running.get(key)?.abort();
      const canceled = { ...job, status: 'CANCELED' as const, completedAt: new Date().toISOString() };
      byFolder.set(key, canceled);
      running.delete(key);
      return canceled;
    },
  };
}
