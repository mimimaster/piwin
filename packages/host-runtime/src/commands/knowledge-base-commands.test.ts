import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextPack, HostPush } from '@piwin/contracts';
import { folderKnowledgeBaseId, NOTES_KNOWLEDGE_BASE_ID } from '@piwin/contracts';
import { canonicalizeFolderPath, createFolderRag, folderKey, type FolderRag } from '@piwin/doc-rag';
import { createNoteStore } from '@piwin/notes';
import { createSessionRecord, upsertSessionRecord } from '@piwin/session';
import { createDefaultPiwinConfig } from '../config-store.js';
import { createSecretResolver } from '../secret-resolver.js';
import { getPiwinSessionIndexPath } from '../paths.js';
import { handleKnowledgeCommand, type KnowledgeCommandContext } from './knowledge-commands.js';

const cleanup: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-kb-cmd-'));
  cleanup.push(root);
  const folder = await mkdtemp(join(tmpdir(), 'piwin-kb-src-'));
  cleanup.push(folder);
  await writeFile(join(folder, 'intro.md'), '# Intro\n\nSpaced repetition schedules reviews.\n');
  const store = createNoteStore({ piwinRoot: root });
  await store.write({ title: 'FSRS', content: 'Spaced repetition schedules reviews.' });
  const rag = createFolderRag({ piwinRoot: root });
  const pushes: HostPush[] = [];
  const context: KnowledgeCommandContext = {
    piwinRoot: root,
    // Probes read the Host-owned key. File-store-only keeps the lookup off the
    // developer's macOS keychain, which already holds piwin-notes-embedding.
    secretResolver: createSecretResolver({ piwinRoot: root, preferFileStore: true }),
    getNotesServices: async () => ({ store }),
    getCardStore: async () => {
      throw new Error('card store unused');
    },
    getFolderRag: async () => rag,
    loadConfig: async () => createDefaultPiwinConfig(),
    push: (message) => {
      pushes.push(message);
    },
  };
  return { root, folder, rag, context, pushes };
}

describe('knowledge base commands', () => {
  it('adds, lists, renames, and rejects a missing folder', async () => {
    const { folder, context, pushes, rag } = await setup();
    const added = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder, name: 'Docs' },
      'r1',
      context,
    );
    expect(added).toMatchObject({ success: true, command: 'knowledge/bases/add' });
    const base = (added as { data: { base: { id: string; name: string; folderPath: string } } }).data
      .base;
    expect(base.name).toBe('Docs');
    const canonical = await canonicalizeFolderPath(folder);
    expect(base.folderPath).toBe(canonical);
    expect(base.id).toBe(folderKnowledgeBaseId(folderKey(canonical ?? folder)));
    expect(pushes.some((push) => push.type === 'knowledge/bases-changed')).toBe(true);

    const again = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder, name: 'Other' },
      'r2',
      context,
    );
    expect(
      (again as { data: { base: { name: string } } }).data.base.name,
    ).toBe('Docs');

    const missing = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: join(folder, 'does-not-exist') },
      'r3',
      context,
    );
    expect(missing).toMatchObject({ success: false });

    const renamed = await handleKnowledgeCommand(
      { type: 'knowledge/bases/rename', baseId: base.id, name: 'Library' },
      'r4',
      context,
    );
    expect((renamed as { data: { base: { name: string } } }).data.base.name).toBe('Library');

    const listed = await handleKnowledgeCommand({ type: 'knowledge/bases/list' }, 'r5', context);
    const bases = (listed as { data: { bases: Array<{ id: string; kind: string }> } }).data.bases;
    expect(bases[0]?.kind).toBe('notes');
    expect(bases.some((item) => item.id === base.id)).toBe(true);

    rag.close();
  });

  it('refuses to remove the notes base and removes a folder base', async () => {
    const { folder, context, rag } = await setup();
    const added = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder },
      'r1',
      context,
    );
    const baseId = (added as { data: { base: { id: string } } }).data.base.id;

    const notesRemove = await handleKnowledgeCommand(
      { type: 'knowledge/bases/remove', baseId: NOTES_KNOWLEDGE_BASE_ID, deleteIndex: false },
      'r2',
      context,
    );
    expect(notesRemove).toMatchObject({ success: false });

    const removed = await handleKnowledgeCommand(
      { type: 'knowledge/bases/remove', baseId, deleteIndex: false },
      'r3',
      context,
    );
    expect(removed).toMatchObject({
      success: true,
      data: { removed: true, baseId },
    });
    const listed = await handleKnowledgeCommand({ type: 'knowledge/bases/list' }, 'r4', context);
    const ids = (listed as { data: { bases: Array<{ id: string }> } }).data.bases.map(
      (base) => base.id,
    );
    expect(ids).not.toContain(baseId);
    rag.close();
  });

  it('searches notes and skips unknown bases', async () => {
    const { context, rag } = await setup();
    const result = await handleKnowledgeCommand(
      {
        type: 'knowledge/search',
        query: 'spaced repetition',
        baseIds: [NOTES_KNOWLEDGE_BASE_ID, 'folder:0123456789abcdef'],
      },
      'r1',
      context,
    );
    expect(result?.success).toBe(true);
    const data = (result as { data: { citations: Array<{ kind: string }>; skipped: Array<{ reason: string }> } })
      .data;
    expect(data.citations.some((citation) => citation.kind === 'notes')).toBe(true);
    expect(data.skipped.some((item) => item.reason === 'unknown')).toBe(true);
    rag.close();
  });

  it('mounts bases on a session index record and pushes session/index-updated', async () => {
    const { root, context, pushes, rag } = await setup();
    await mkdir(join(root, 'sessions-index'), { recursive: true });
    const indexPath = getPiwinSessionIndexPath(root);
    await upsertSessionRecord(
      indexPath,
      createSessionRecord({
        id: 'session-1',
        projectPath: root,
        name: 'chat',
      }),
    );
    const response = await handleKnowledgeCommand(
      {
        type: 'session/set-knowledge-bases',
        sessionId: 'session-1',
        baseIds: [NOTES_KNOWLEDGE_BASE_ID],
      },
      'r1',
      context,
    );
    expect(response).toMatchObject({
      success: true,
      data: { sessionId: 'session-1', baseIds: [NOTES_KNOWLEDGE_BASE_ID] },
    });
    expect(
      pushes.some(
        (push) =>
          push.type === 'session/index-updated' &&
          push.op === 'updated' &&
          push.session?.knowledgeBaseIds?.[0] === NOTES_KNOWLEDGE_BASE_ID,
      ),
    ).toBe(true);
    rag.close();
  });

  it('open-source for a folder citation is confined', async () => {
    const { folder, context, rag } = await setup();
    const added = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder },
      'r1',
      context,
    );
    const base = (added as { data: { base: { id: string } } }).data.base;
    const blocked = await handleKnowledgeCommand(
      {
        type: 'knowledge/open-source',
        citation: {
          ref: 1,
          baseId: base.id,
          baseName: 'Docs',
          kind: 'folder',
          title: 'secret',
          relativePath: '../etc/passwd',
          text: '',
        },
      },
      'r2',
      context,
    );
    expect(blocked).toMatchObject({ success: false });

    const opened = await handleKnowledgeCommand(
      {
        type: 'knowledge/open-source',
        citation: {
          ref: 1,
          baseId: base.id,
          baseName: 'Docs',
          kind: 'folder',
          title: 'intro.md',
          relativePath: 'intro.md',
          startLine: 1,
          text: 'Intro',
        },
      },
      'r3',
      context,
    );
    expect(opened).toMatchObject({ success: true });
    const data = (opened as { data: { kind: string; opened: boolean; absolutePath: string } }).data;
    expect(data.kind).toBe('folder');
    expect(data.opened).toBe(false);
    expect(data.absolutePath.endsWith('intro.md')).toBe(true);
    rag.close();
  });
});

describe('folder retrieve mapping via mocked rag', () => {
  it('returns folder citations from retrievePack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-kb-mock-'));
    cleanup.push(root);
    const folder = await mkdtemp(join(tmpdir(), 'piwin-kb-mock-src-'));
    cleanup.push(folder);
    await writeFile(join(folder, 'a.md'), 'hello');
    const pack: ContextPack = {
      query: 'hello',
      folderKey: '0123456789abcdef',
      retrievalMode: 'fts_only',
      degraded: true,
      sources: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          relativePath: 'a.md',
          startLine: 1,
          endLine: 1,
          text: 'hello world',
          retrievalScore: 0.9,
          retrievedBy: 'fts',
        },
      ],
    };
    const rag = {
      hasEmbeddingProvider: false,
      scanFolder: async () => ({ files: [], supportedExtensions: [] }),
      indexFolder: async () => ({
        indexed: 0,
        chunks: 0,
        degraded: true,
        skipped: 0,
        failed: 0,
        warnings: [],
      }),
      retrieve: async () => [],
      retrievePack: vi.fn(async () => pack),
      listDocuments: async () => [
        {
          documentId: 'd1',
          folderKey: '0123456789abcdef',
          relativePath: 'a.md',
          extension: '.md',
          fileSize: 5,
          fileHash: 'h',
          status: 'READY',
          chunkCount: 1,
          indexedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      isIndexed: async () => true,
      forgetFolder: async () => undefined,
      close: () => undefined,
    } as unknown as FolderRag;
    const store = createNoteStore({ piwinRoot: root });
    const context: KnowledgeCommandContext = {
      piwinRoot: root,
      getNotesServices: async () => ({ store }),
      getCardStore: async () => {
        throw new Error('unused');
      },
      getFolderRag: async () => rag,
      loadConfig: async () => createDefaultPiwinConfig(),
    };
    const added = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder },
      'a1',
      context,
    );
    const baseId = (added as { data: { base: { id: string } } }).data.base.id;
    const searched = await handleKnowledgeCommand(
      { type: 'knowledge/search', query: 'hello', baseIds: [baseId] },
      's1',
      context,
    );
    const data = (
      searched as { data: { citations: Array<{ relativePath?: string }>; degradedBaseIds: string[] } }
    ).data;
    expect(data.citations[0]?.relativePath).toBe('a.md');
    expect(data.degradedBaseIds).toContain(baseId);
  });

  it('handles knowledge/wiki/overview and knowledge/wiki/concept', async () => {
    const { root, context, rag } = await setup();
    const overviewRes = await handleKnowledgeCommand(
      { type: 'knowledge/wiki/overview' },
      'w1',
      context,
    );
    expect(overviewRes).toMatchObject({ success: true, command: 'knowledge/wiki/overview' });
    const overviewData = (overviewRes as { data: { totalConcepts: number; indexContent: string } }).data;
    expect(overviewData.totalConcepts).toBe(0);
    expect(overviewData.indexContent).toContain('# Knowledge Index');

    // Create a concept file
    const wikiConceptsDir = join(root, 'wiki', 'concepts');
    await mkdir(wikiConceptsDir, { recursive: true });
    await writeFile(
      join(wikiConceptsDir, 'attention.md'),
      '---\ntitle: Attention\ntags: [nlp]\n---\n# Attention\n\nMechanism for [[Transformers]].',
      'utf8',
    );

    const conceptRes = await handleKnowledgeCommand(
      { type: 'knowledge/wiki/concept', slug: 'attention' },
      'w2',
      context,
    );
    expect(conceptRes).toMatchObject({ success: true, command: 'knowledge/wiki/concept' });
    const conceptData = (conceptRes as { data: { concept: { title: string; links: string[] } } }).data.concept;
    expect(conceptData.title).toBe('Attention');
    expect(conceptData.links).toEqual(['Transformers']);

    rag.close();
  });

  it('writes a sourced wiki note and does not overwrite the same title', async () => {
    const { context, rag } = await setup();
    const input = {
      title: 'Sleep debt',
      content: 'Hours owed to sleep.',
      sources: [
        {
          baseId: 'folder:abc',
          relativePath: 'notes/sleep-debt.md',
          lineStart: 3,
        },
      ],
    };
    const written = await handleKnowledgeCommand(
      { type: 'knowledge/wiki/write', input },
      'wn1',
      context,
    );
    expect(written).toMatchObject({ success: true, command: 'knowledge/wiki/write' });
    const concept = (written as { data: { concept: { slug: string; sources?: unknown } } }).data
      .concept;
    expect(concept.slug).toBe('sleep-debt');
    expect(concept.sources).toEqual(input.sources);

    const read = await handleKnowledgeCommand(
      { type: 'knowledge/wiki/concept', slug: 'sleep-debt' },
      'wn2',
      context,
    );
    const roundTrip = (read as { data: { concept: { sources?: unknown; content: string } } }).data
      .concept;
    expect(roundTrip.sources).toEqual(input.sources);
    expect(roundTrip.content).toContain('Hours owed');

    const duplicate = await handleKnowledgeCommand(
      {
        type: 'knowledge/wiki/write',
        input: { title: 'Sleep debt', content: 'Must not land.' },
      },
      'wn3',
      context,
    );
    expect(duplicate).toMatchObject({
      success: false,
      command: 'knowledge/wiki/write',
      error: expect.stringContaining('already exists'),
    });
    rag.close();
  });

  it('rejects a wiki update when the expected hash is stale', async () => {
    const { context, rag } = await setup();
    const written = await handleKnowledgeCommand(
      {
        type: 'knowledge/wiki/write',
        input: { title: 'Sleep debt', content: 'Hours owed.', kind: 'note' },
      },
      'cu1',
      context,
    );
    const hash = (written as { data: { concept: { contentHash: string } } }).data.concept.contentHash;
    expect(hash).toEqual(expect.any(String));

    const conflict = await handleKnowledgeCommand(
      {
        type: 'knowledge/wiki/update',
        input: { slug: 'sleep-debt', expectedContentHash: 'stale', content: 'Nope.' },
      },
      'cu2',
      context,
    );
    expect(conflict).toMatchObject({
      success: false,
      command: 'knowledge/wiki/update',
      problem: { code: 'wiki-revision-conflict' },
    });

    const updated = await handleKnowledgeCommand(
      {
        type: 'knowledge/wiki/update',
        input: { slug: 'sleep-debt', expectedContentHash: hash, content: 'Hours still owed.' },
      },
      'cu3',
      context,
    );
    expect(updated).toMatchObject({ success: true, command: 'knowledge/wiki/update' });
    const concept = (updated as { data: { concept: { content: string; kind?: string } } }).data.concept;
    expect(concept.content).toBe('Hours still owed.');
    expect(concept.kind).toBe('note');
    rag.close();
  });

  it('returns a distill draft for two files without writing a page', async () => {
    const { folder, context, rag } = await setup();
    const added = await handleKnowledgeCommand(
      { type: 'knowledge/bases/add', folderPath: folder, name: 'Docs' },
      'dd0',
      context,
    );
    const baseId = (added as { data: { base: { id: string } } }).data.base.id;
    const retrievePack = vi.spyOn(rag, 'retrievePack').mockResolvedValue({
      sources: [
        { relativePath: 'a.md', text: 'alpha excerpt' },
        { relativePath: 'b.md', text: 'beta excerpt' },
      ],
    } as ContextPack);
    const withModel: typeof context = {
      ...context,
      completeJson: async () => ({
        title: 'Batch concept',
        summary: 'From two files.',
        tags: ['batch'],
        content: 'Draft only.',
      }),
    };
    const response = await handleKnowledgeCommand(
      {
        type: 'knowledge/wiki/distill-draft',
        baseId,
        relativePaths: ['a.md', 'b.md'],
      },
      'dd1',
      withModel,
    );
    expect(retrievePack).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ fileAllowlist: ['a.md', 'b.md'] }),
    );
    expect(response).toMatchObject({ success: true, command: 'knowledge/wiki/distill-draft' });
    const draft = (response as { data: { draft: { title: string; sources: unknown[] } } }).data.draft;
    expect(draft.title).toBe('Batch concept');
    expect(draft.sources).toEqual([
      { baseId, relativePath: 'a.md' },
      { baseId, relativePath: 'b.md' },
    ]);
    const overview = await handleKnowledgeCommand({ type: 'knowledge/wiki/overview' }, 'dd2', context);
    const concepts = (overview as { data: { concepts: unknown[] } }).data.concepts;
    expect(concepts).toHaveLength(0);
    rag.close();
  });

  it('keeps wiki distill reachable through the outer knowledge gate', async () => {
    // `isKnowledgeCommand` is the single entry check for every knowledge
    // command, so a type missing from that set returns null and dies upstream
    // as an unhandled command instead of reaching the handler below.
    const { context, rag } = await setup();
    const response = await handleKnowledgeCommand(
      { type: 'knowledge/wiki/distill', baseId: NOTES_KNOWLEDGE_BASE_ID },
      'd1',
      context,
    );
    expect(response).toMatchObject({
      success: false,
      command: 'knowledge/wiki/distill',
      error: expect.stringContaining('No model is configured'),
    });
    rag.close();
  });
});

/**
 * The desktop renderer cannot reach an embedding / reranker endpoint itself —
 * its CSP keeps `connect-src` on `'self'`/`ipc:` — so "Test connection" runs
 * here. These cases pin the two things that matter: the round trip happens on
 * the Host, and the stored key is resolved on the Host instead of being pulled
 * back into the renderer.
 */
describe('knowledge/test-connection', () => {
  function embeddingResponse(): Response {
    return new Response(JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.01) }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('probes the endpoint on the Host and reports the vector width', async () => {
    const { context, rag } = await setup();
    const fetchMock = vi.fn(async () => embeddingResponse());
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleKnowledgeCommand(
      {
        type: 'knowledge/test-connection',
        kind: 'embedding',
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
      },
      't1',
      context,
    );

    expect(response).toMatchObject({ success: true, command: 'knowledge/test-connection' });
    expect((response as { data: { dimension: number } }).data.dimension).toBe(1536);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );

    rag.close();
  });

  it('resolves a Host-stored apiKeyRef without the renderer holding the key', async () => {
    const { root, context, rag } = await setup();
    const apiKeyRef = await createSecretResolver({
      piwinRoot: root,
      preferFileStore: true,
    }).writeProviderSecret('kb-probe-stored', 'stored-key');
    const fetchMock = vi.fn(async () => embeddingResponse());
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleKnowledgeCommand(
      {
        type: 'knowledge/test-connection',
        kind: 'embedding',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        apiKeyRef,
      },
      't2',
      context,
    );

    expect(response).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        headers: { 'content-type': 'application/json', authorization: 'Bearer stored-key' },
      }),
    );

    rag.close();
  });

  it('discovers embedding models with the Host key when a remote client has a redacted ref', async () => {
    const { root, context, rag } = await setup();
    const apiKeyRef = await createSecretResolver({
      piwinRoot: root,
      preferFileStore: true,
    }).writeProviderSecret('notes-embedding', 'stored-key');
    context.loadConfig = async () => ({
      ...createDefaultPiwinConfig(),
      notes: {
        embedding: {
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'text-embedding-3-small',
          apiKeyRef,
        },
      },
    });
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: [{ id: 'text-embedding-3-small' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleKnowledgeCommand(
      {
        type: 'knowledge/embedding-models/discover',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyRef: '[stored-secret]',
      },
      'd1',
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: { models: [{ id: 'text-embedding-3-small' }] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer stored-key');

    await handleKnowledgeCommand(
      {
        type: 'knowledge/embedding-models/discover',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyRef: '[stored-secret]',
        apiKey: 'fresh-key',
      },
      'd2',
      context,
    );
    const freshHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(freshHeaders.get('authorization')).toBe('Bearer fresh-key');
    rag.close();
  });

  it('tests an embedding with the Host key when a remote client has a redacted ref', async () => {
    const { root, context, rag } = await setup();
    const apiKeyRef = await createSecretResolver({
      piwinRoot: root,
      preferFileStore: true,
    }).writeProviderSecret('notes-embedding', 'stored-key');
    context.loadConfig = async () => ({
      ...createDefaultPiwinConfig(),
      notes: {
        embedding: {
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'text-embedding-3-small',
          apiKeyRef,
        },
      },
    });
    const fetchMock = vi.fn(async () => embeddingResponse());
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleKnowledgeCommand(
      {
        type: 'knowledge/test-connection',
        kind: 'embedding',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        apiKeyRef: '[stored-secret]',
      },
      't-remote',
      context,
    );

    expect(response).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        headers: { 'content-type': 'application/json', authorization: 'Bearer stored-key' },
      }),
    );
    rag.close();
  });

  it('lets a just-typed key win over the stored reference', async () => {
    const { root, context, rag } = await setup();
    const apiKeyRef = await createSecretResolver({
      piwinRoot: root,
      preferFileStore: true,
    }).writeProviderSecret('kb-probe-oneshot', 'stored-key');
    const fetchMock = vi.fn(async () => embeddingResponse());
    vi.stubGlobal('fetch', fetchMock);

    await handleKnowledgeCommand(
      {
        type: 'knowledge/test-connection',
        kind: 'embedding',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        apiKey: 'typed-key',
        apiKeyRef,
      },
      't3',
      context,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        headers: { 'content-type': 'application/json', authorization: 'Bearer typed-key' },
      }),
    );

    rag.close();
  });

  it('returns the endpoint error as a failed response instead of throwing', async () => {
    const { context, rag } = await setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const response = await handleKnowledgeCommand(
      {
        type: 'knowledge/test-connection',
        kind: 'embedding',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
      },
      't4',
      context,
    );

    expect(response).toMatchObject({
      success: false,
      command: 'knowledge/test-connection',
      error: 'Incorrect API key provided',
    });

    rag.close();
  });

  it('reports a missing model id without dialing out', async () => {
    const { context, rag } = await setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleKnowledgeCommand(
      {
        type: 'knowledge/test-connection',
        kind: 'reranker',
        baseUrl: 'https://api.jina.ai/v1',
        model: '',
      },
      't5',
      context,
    );

    expect(response).toMatchObject({ success: false, error: 'Model ID is required' });
    expect(fetchMock).not.toHaveBeenCalled();

    rag.close();
  });
});
