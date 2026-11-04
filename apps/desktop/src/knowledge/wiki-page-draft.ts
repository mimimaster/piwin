import type {
  HostCommand,
  HostResponse,
  WikiConceptDetail,
  WikiDistillDraft,
  WikiPageKind,
  WikiRelatedPage,
  WikiSourceRef,
} from '@piwin/contracts';

export type WikiPageDraft = {
  title: string;
  content: string;
  slug?: string;
  expectedContentHash?: string;
  summary?: string;
  tags?: string[];
  sources?: WikiSourceRef[];
  relatedPages?: WikiRelatedPage[];
  existingPage?: WikiDistillDraft['existingPage'];
  saveAs?: 'create' | 'update';
  kind?: WikiPageKind;
};

export function draftFromConcept(concept: WikiConceptDetail): WikiPageDraft | null {
  const hash = concept.contentHash;
  if (!hash) return null;
  return {
    title: concept.title,
    content: concept.content,
    slug: concept.slug,
    expectedContentHash: hash,
  };
}

export function emptyWikiNoteDraft(): WikiPageDraft {
  return { title: '', content: '', kind: 'note' };
}

export function draftFromDistill(draft: WikiDistillDraft): WikiPageDraft {
  return {
    title: draft.title,
    content: draft.content,
    summary: draft.summary,
    tags: draft.tags,
    sources: draft.sources,
    relatedPages: draft.relatedPages,
    kind: 'concept',
    saveAs: draft.existingPage ? 'update' : 'create',
    ...(draft.existingPage
      ? {
          existingPage: draft.existingPage,
          slug: draft.existingPage.slug,
          expectedContentHash: draft.existingPage.contentHash,
        }
      : {}),
  };
}

export function setWikiDraftSaveAs(
  draft: WikiPageDraft,
  saveAs: 'create' | 'update',
): WikiPageDraft {
  if (saveAs === 'update' && draft.existingPage) {
    return {
      ...draft,
      saveAs,
      slug: draft.existingPage.slug,
      expectedContentHash: draft.existingPage.contentHash,
    };
  }
  const { slug: _slug, expectedContentHash: _hash, ...rest } = draft;
  return {
    ...rest,
    saveAs: 'create',
  };
}

export async function requestWikiDistillDraft(
  request: (command: HostCommand) => Promise<HostResponse>,
  input: { baseId: string; relativePaths?: string[]; topic?: string },
): Promise<{ ok: true; draft: WikiPageDraft } | { ok: false; error: string }> {
  const response = await request({
    type: 'knowledge/wiki/distill-draft',
    baseId: input.baseId,
    ...(input.topic ? { topic: input.topic } : {}),
    ...(input.relativePaths && input.relativePaths.length > 0
      ? { relativePaths: input.relativePaths }
      : {}),
  });
  if (!response.success) {
    return { ok: false, error: response.error };
  }
  const draft = (response.data as { draft?: WikiDistillDraft } | undefined)?.draft;
  if (!draft) {
    return { ok: false, error: 'Distill returned no draft' };
  }
  return { ok: true, draft: draftFromDistill(draft) };
}

export async function saveWikiPageDraft(
  request: (command: HostCommand) => Promise<HostResponse>,
  draft: WikiPageDraft,
): Promise<{ ok: true; concept: WikiConceptDetail } | { ok: false; error: string; conflict: boolean }> {
  const title = draft.title.trim();
  const content = draft.content.trim();
  if (!title || !content) {
    return { ok: false, error: 'Wiki note needs a title and body', conflict: false };
  }
  const response =
    draft.slug && draft.expectedContentHash
      ? await request({
          type: 'knowledge/wiki/update',
          input: {
            slug: draft.slug,
            expectedContentHash: draft.expectedContentHash,
            title,
            content,
            ...(draft.summary ? { summary: draft.summary } : {}),
            ...(draft.tags && draft.tags.length > 0 ? { tags: draft.tags } : {}),
            ...(draft.sources && draft.sources.length > 0 ? { sources: draft.sources } : {}),
          },
        })
      : await request({
          type: 'knowledge/wiki/write',
          input: {
            title,
            content,
            kind: draft.kind ?? 'note',
            ...(draft.summary ? { summary: draft.summary } : {}),
            ...(draft.tags && draft.tags.length > 0 ? { tags: draft.tags } : {}),
            ...(draft.sources && draft.sources.length > 0 ? { sources: draft.sources } : {}),
          },
        });
  if (!response.success) {
    return {
      ok: false,
      error: response.error,
      conflict: response.problem?.code === 'wiki-revision-conflict',
    };
  }
  const concept = (response.data as { concept?: WikiConceptDetail } | undefined)?.concept;
  if (!concept) {
    return { ok: false, error: 'Wiki save returned no page', conflict: false };
  }
  return { ok: true, concept };
}
