import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendWikiLog,
  ensureWikiInitialized,
  getWikiOverview,
  listWikiConcepts,
  readWikiConcept,
  readWikiIndex,
} from './wiki-service.js';

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
});
