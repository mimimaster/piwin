import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFolderRag } from '@piwin/doc-rag';
import { createNoteStore } from '@piwin/notes';
import { createDefaultPiwinConfig } from './config-store.js';
import {
  addFolderKnowledgeBase,
  listKnowledgeBaseSummaries,
  type KnowledgeBaseRuntime,
} from './knowledge-base-service.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function runtimeIn(root: string): Promise<{ runtime: KnowledgeBaseRuntime; rag: ReturnType<typeof createFolderRag> }> {
  const rag = createFolderRag({ piwinRoot: root });
  const runtime: KnowledgeBaseRuntime = {
    piwinRoot: root,
    getFolderRag: async () => rag,
    loadConfig: async () => createDefaultPiwinConfig(),
  };
  return { runtime, rag };
}

describe('listKnowledgeBaseSummaries — notes state', () => {
  it('reports a never-used notes base as empty, not not-indexed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-kbs-'));
    cleanup.push(root);
    const { runtime, rag } = await runtimeIn(root);
    try {
      const summaries = await listKnowledgeBaseSummaries(runtime);
      const notes = summaries.find((base) => base.kind === 'notes');
      expect(notes?.state).toBe('empty');
    } finally {
      rag.close();
    }
  });

  it('reports notes as ready once a note is written and indexed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-kbs-'));
    cleanup.push(root);
    const { runtime, rag } = await runtimeIn(root);
    try {
      const store = createNoteStore({ piwinRoot: root });
      const note = await store.write({ title: 'Hello', content: 'Body' });
      await rag.ingestFile(join(root, 'notes'), note.relativePath);
      const summaries = await listKnowledgeBaseSummaries(runtime);
      const notes = summaries.find((base) => base.kind === 'notes');
      expect(notes?.state).toBe('ready');
      expect(notes?.documentCount).toBe(1);
    } finally {
      rag.close();
    }
  });

  it('leaves a never-indexed plain folder as not-indexed, not empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-kbs-'));
    const folder = await mkdtemp(join(tmpdir(), 'piwin-kbs-folder-'));
    cleanup.push(root, folder);
    const { runtime, rag } = await runtimeIn(root);
    try {
      const added = await addFolderKnowledgeBase(runtime, folder, 'Docs');
      const summaries = await listKnowledgeBaseSummaries(runtime);
      const found = summaries.find((base) => base.id === added.id);
      expect(found?.state).toBe('not-indexed');
    } finally {
      rag.close();
    }
  });
});
