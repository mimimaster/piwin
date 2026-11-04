import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendWikiLog,
  ensureWikiInitialized,
  getWikiOverview,
  listWikiConcepts,
  readWikiConcept,
  readWikiIndex,
  WikiPageExistsError,
  writeWikiConcept,
} from './wiki-service.js';
import { updateWikiConcept, WikiRevisionConflictError } from './wiki-mutate.js';

describe('wiki-service', () => {
  it('initializes wiki directory structure with INDEX.md and LOG.md', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'piwin-wiki-test-'));
    try {
      const wikiDir = await ensureWikiInitialized(tempDir);
      expect(wikiDir).toContain('wiki');

      const index = await readWikiIndex(tempDir);
      expect(index).toContain('# Knowledge Index');
      expect(index).toContain('## Concepts');

      await appendWikiLog(tempDir, 'test-action', 'created test concept');

      // Create a dummy concept file
      const conceptContent = `---
title: KV Cache
summary: Key-value cache optimization
tags: [transformer, inference]
---
# KV Cache

Optimizes [[Self-Attention]] inference.`;

      await writeFile(join(wikiDir, 'concepts', 'kv-cache.md'), conceptContent, 'utf8');

      const concepts = await listWikiConcepts(tempDir);
      expect(concepts).toHaveLength(1);
      expect(concepts[0]?.slug).toBe('kv-cache');
      expect(concepts[0]?.title).toBe('KV Cache');
      expect(concepts[0]?.tags).toEqual(['transformer', 'inference']);

      const detail = await readWikiConcept(tempDir, 'kv-cache');
      expect(detail).not.toBeNull();
      expect(detail?.title).toBe('KV Cache');
      expect(detail?.links).toEqual(['Self-Attention']);
      expect(detail?.content).toContain('Optimizes [[Self-Attention]] inference.');

      const overview = await getWikiOverview(tempDir);
      expect(overview.totalConcepts).toBe(1);
      expect(overview.concepts).toHaveLength(1);
      expect(overview.logSnippet).toContain('created test concept');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('round-trips source metadata and refuses to overwrite an existing page', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'piwin-wiki-note-'));
    try {
      const sources = [
        {
          baseId: 'folder:abc',
          relativePath: 'notes/sleep-debt.md',
          lineStart: 3,
          lineEnd: 8,
          snapshotText: 'Sleep debt compounds.',
        },
      ];
      const created = await writeWikiConcept(tempDir, {
        title: 'Sleep debt',
        content: 'Debt is the hours you owe sleep.',
        summary: 'From the reading assistant',
        tags: ['sleep'],
        sources,
        createOnly: true,
      });
      expect(created.slug).toBe('sleep-debt');
      expect(created.sources).toEqual(sources);

      const read = await readWikiConcept(tempDir, 'sleep-debt');
      expect(read?.sources).toEqual(sources);
      expect(read?.content).toContain('hours you owe sleep');

      await expect(
        writeWikiConcept(tempDir, {
          title: 'Sleep debt',
          content: 'This must not replace the page.',
          createOnly: true,
        }),
      ).rejects.toBeInstanceOf(WikiPageExistsError);

      const after = await readWikiConcept(tempDir, 'sleep-debt');
      expect(after?.content).toContain('hours you owe sleep');
      expect(after?.content).not.toContain('must not replace');
      expect(after?.sources).toEqual(sources);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('conflicts on a stale hash and reconciles after an external edit', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'piwin-wiki-cas-'));
    try {
      const sources = [{ baseId: 'folder:abc', relativePath: 'notes/sleep-debt.md', lineStart: 3 }];
      const created = await writeWikiConcept(tempDir, {
        title: 'Sleep debt',
        content: 'Original body.',
        sources,
        kind: 'note',
        createOnly: true,
      });
      expect(created.contentHash).toEqual(expect.any(String));
      expect(created.kind).toBe('note');

      await expect(
        updateWikiConcept(tempDir, {
          slug: 'sleep-debt',
          expectedContentHash: 'deadbeef',
          content: 'Lost write.',
        }),
      ).rejects.toBeInstanceOf(WikiRevisionConflictError);
      expect((await readWikiConcept(tempDir, 'sleep-debt'))?.content).toContain('Original body.');

      const overwritten = await writeWikiConcept(tempDir, {
        title: 'Sleep debt',
        content: 'Agent rewrite without sources.',
      });
      expect(overwritten.sources).toEqual(sources);
      expect(overwritten.kind).toBe('note');
      expect(overwritten.content).toContain('Agent rewrite');

      const wikiDir = await ensureWikiInitialized(tempDir);
      const path = join(wikiDir, 'concepts', 'sleep-debt.md');
      const onDisk = await readFile(path, 'utf8');
      const externally = onDisk.replace('Agent rewrite without sources.', 'Edited in another app.');
      await writeFile(path, externally, 'utf8');

      const reconciled = await readWikiConcept(tempDir, 'sleep-debt');
      expect(reconciled?.content).toContain('Edited in another app.');
      expect(reconciled?.sources).toEqual(sources);
      expect(reconciled?.contentHash).not.toBe(overwritten.contentHash);

      await expect(
        updateWikiConcept(tempDir, {
          slug: 'sleep-debt',
          expectedContentHash: overwritten.contentHash ?? '',
          content: 'Should fail.',
        }),
      ).rejects.toBeInstanceOf(WikiRevisionConflictError);

      const saved = await updateWikiConcept(tempDir, {
        slug: 'sleep-debt',
        expectedContentHash: reconciled?.contentHash ?? '',
        content: 'Resolved after reload.',
      });
      expect(saved.content).toBe('Resolved after reload.');
      expect(saved.sources).toEqual(sources);
      expect(saved.contentHash).not.toBe(reconciled?.contentHash);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
