/**
 * Card drafts from an explicit scope. Selection and page use the supplied
 * text (no folder index). Files retrieve only those paths. Nothing is written.
 */
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { ContextPack, FlashcardCreateInput, FlashcardDraftResult, FlashcardDraftScope } from '@piwin/contracts';
import {
  runTwoStageGeneration,
  toFlashcardCreateInputs,
  type CompleteJsonFn,
} from '@piwin/doc-rag';

export class FlashcardScopeDraftError extends Error {
  override readonly name = 'FlashcardScopeDraftError';
}

export type RetrieveScopedPack = (
  folderPath: string,
  query: string,
  options: { fileAllowlist: string[]; limit: number },
) => Promise<ContextPack>;

function hashSource(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function packFromText(input: {
  text: string;
  sourceFile: string;
  sourceLine?: number;
  query: string;
}): ContextPack {
  return {
    query: input.query,
    folderKey: 'scope-draft',
    retrievalMode: 'fts_only',
    degraded: false,
    sources: [
      {
        chunkId: 'scope-1',
        documentId: 'scope',
        relativePath: input.sourceFile,
        text: input.text,
        retrievedBy: 'fts',
        ...(typeof input.sourceLine === 'number' ? { startLine: input.sourceLine } : {}),
      },
    ],
  };
}

function countsOf(drafts: readonly FlashcardCreateInput[]): FlashcardDraftResult['counts'] {
  let basic = 0;
  let cloze = 0;
  for (const draft of drafts) {
    if (draft.model === 'cloze') cloze += 1;
    else basic += 1;
  }
  return { basic, cloze };
}

export async function draftFlashcardsFromScope(input: {
  scope: FlashcardDraftScope;
  completeJson: CompleteJsonFn;
  existingFronts: readonly string[];
  retrievePack?: RetrieveScopedPack;
}): Promise<FlashcardDraftResult> {
  const scope = input.scope;
  let pack: ContextPack;
  let folderPath = '';
  if (scope.kind === 'files') {
    if (scope.relativePaths.length === 0) {
      throw new FlashcardScopeDraftError('files scope needs at least one relative path');
    }
    if (!input.retrievePack) {
      throw new FlashcardScopeDraftError('files scope needs indexed retrieval');
    }
    pack = await input.retrievePack(scope.folderPath, scope.topic?.trim() || scope.folderPath, {
      fileAllowlist: scope.relativePaths,
      limit: 12,
    });
    folderPath = scope.folderPath;
  } else {
    const text = scope.text.trim();
    if (!text) {
      throw new FlashcardScopeDraftError('selection and page scopes need source text');
    }
    pack = packFromText({
      text,
      sourceFile: scope.sourceFile ?? (scope.kind === 'page' ? 'page.md' : 'selection.md'),
      query: scope.topic?.trim() || text.slice(0, 80),
      ...(typeof scope.sourceLine === 'number' ? { sourceLine: scope.sourceLine } : {}),
    });
    folderPath = scope.sourceFolder ?? '';
  }
  if (pack.sources.length === 0) {
    throw new FlashcardScopeDraftError('This scope has no indexed slices yet — ingest it before generating cards.');
  }

  const generationId = `draft-${randomUUID().slice(0, 8)}`;
  const staged = await runTwoStageGeneration({
    topic: scope.topic?.trim() || (scope.kind === 'files' ? scope.folderPath : scope.kind),
    workspaceName: scope.deck ?? 'Knowledge',
    pack,
    existingFronts: [...input.existingFronts],
    generationId,
    completeJson: input.completeJson,
  });
  const tags = [...new Set([...(scope.tags ?? []), ...(scope.topic ? [scope.topic] : [])])];
  const wikiSlug = scope.kind === 'files' ? undefined : scope.wikiSlug;
  const sourceHash =
    scope.kind === 'files' ? undefined : hashSource(scope.text);
  const drafts = toFlashcardCreateInputs({
    cards: staged.cards,
    folderPath,
    generationId,
    sequenceId: generationId,
    deck: scope.deck ?? 'Knowledge',
    pack,
  }).map((draft) => ({
    ...draft,
    ...(tags.length > 0 ? { tags } : {}),
    ...(wikiSlug ? { wikiSlug } : {}),
    ...(sourceHash ? { sourceHash } : {}),
  }));
  return { drafts, counts: countsOf(drafts) };
}
