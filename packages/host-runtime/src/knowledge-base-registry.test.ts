import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalizeFolderPath, folderKey, getSourcePathSidecar } from '@piwin/doc-rag';
import { getNotesRoot } from '@piwin/notes';
import { folderKnowledgeBaseId } from '@piwin/contracts';
import {
  defaultFolderBaseName,
  findFolderRecordById,
  loadKnowledgeBaseRegistry,
  recoverKnowledgeBaseRegistry,
  saveKnowledgeBaseRegistry,
} from './knowledge-base-registry.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-kb-registry-'));
  cleanup.push(root);
  return root;
}

describe('knowledge base registry', () => {
  it('loads an empty document when the file is missing', async () => {
    const root = await tempRoot();
    await expect(loadKnowledgeBaseRegistry(root)).resolves.toEqual({
      version: 1,
      folders: [],
      removed: [],
    });
  });

  it('round-trips name, canonical folderPath, createdAt, and lastUsedAt', async () => {
    const root = await tempRoot();
    await saveKnowledgeBaseRegistry(root, {
      version: 1,
      folders: [
        {
          name: 'Docs',
          folderPath: '/tmp/docs',
          createdAt: '2026-09-01T00:00:00.000Z',
          lastUsedAt: '2026-09-02T00:00:00.000Z',
        },
      ],
      removed: [],
    });
    const loaded = await loadKnowledgeBaseRegistry(root);
    expect(loaded.folders).toEqual([
      {
        name: 'Docs',
        folderPath: '/tmp/docs',
        createdAt: '2026-09-01T00:00:00.000Z',
        lastUsedAt: '2026-09-02T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(loaded)).not.toContain('state');
    expect(JSON.stringify(loaded)).not.toContain('documentCount');
  });

  it('recovers unregistered sidecar folders, including missing paths, and is idempotent', async () => {
    const root = await tempRoot();
    const existing = await mkdtemp(join(tmpdir(), 'piwin-kb-src-'));
    cleanup.push(existing);
    const missingPath = join(root, 'gone-folder');
    await mkdir(join(root, 'doc-rag', folderKey(existing)), { recursive: true });
    await writeFile(getSourcePathSidecar(existing, root), existing, 'utf8');
    await mkdir(join(root, 'doc-rag', folderKey(missingPath)), { recursive: true });
    await writeFile(getSourcePathSidecar(missingPath, root), missingPath, 'utf8');

    expect(await recoverKnowledgeBaseRegistry(root)).toBe(true);
    const first = await loadKnowledgeBaseRegistry(root);
    expect(first.folders.map((record) => record.folderPath).sort()).toEqual(
      [existing, missingPath].sort(),
    );
    const missing = first.folders.find((record) => record.folderPath === missingPath);
    expect(missing?.name).toBe(defaultFolderBaseName(missingPath));
    expect(findFolderRecordById(first, folderKnowledgeBaseId(folderKey(missingPath)))).toEqual(
      missing,
    );

    expect(await recoverKnowledgeBaseRegistry(root)).toBe(false);
    const second = await loadKnowledgeBaseRegistry(root);
    expect(second.folders).toHaveLength(2);
  });

  it('does not recover tombstoned folderKeys or the notes sidecar', async () => {
    const root = await tempRoot();
    const existing = await mkdtemp(join(tmpdir(), 'piwin-kb-tomb-'));
    cleanup.push(existing);
    await mkdir(join(root, 'doc-rag', folderKey(existing)), { recursive: true });
    await writeFile(getSourcePathSidecar(existing, root), existing, 'utf8');

    const notesRoot = getNotesRoot(root);
    await mkdir(notesRoot, { recursive: true });
    const notesCanonical = await canonicalizeFolderPath(notesRoot);
    if (!notesCanonical) throw new Error('notes root missing');
    await mkdir(join(root, 'doc-rag', folderKey(notesCanonical)), { recursive: true });
    await writeFile(getSourcePathSidecar(notesCanonical, root), notesCanonical, 'utf8');

    await saveKnowledgeBaseRegistry(root, {
      version: 1,
      folders: [],
      removed: [{ folderKey: folderKey(existing), removedAt: '2026-09-01T00:00:00.000Z' }],
    });
    expect(await recoverKnowledgeBaseRegistry(root)).toBe(false);
    const loaded = await loadKnowledgeBaseRegistry(root);
    expect(loaded.folders).toEqual([]);
  });

  it('surfaces a corrupt registry instead of treating it as empty', async () => {
    const root = await tempRoot();
    await mkdir(join(root, 'knowledge'), { recursive: true });
    await writeFile(join(root, 'knowledge', 'bases.json'), '{not-json', 'utf8');
    await expect(loadKnowledgeBaseRegistry(root)).rejects.toThrow(/corrupt/);
  });
});
