import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompleteJsonFn } from '@piwin/doc-rag';
import { distillWikiConcept, WikiDistillError } from './wiki-distill.js';
import { listWikiConcepts, readWikiConcept, readWikiIndex } from './wiki-service.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function rootDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-distill-'));
  cleanup.push(dir);
  return dir;
}

const base = { id: 'folder:abc', name: 'fsrs-papers' };

describe('distillWikiConcept', () => {
  it('writes the concept, its INDEX row, and a LOG entry', async () => {
    const root = await rootDir();
    const completeJson = vi.fn(async () => ({
      title: 'FSRS 调度器',
      summary: '基于留存率建模的间隔重复调度算法。',
      tags: ['fsrs', 'memory'],
      content: '正文。相关：[[间隔重复理论]]。',
    }));

    const result = await distillWikiConcept({
      piwinRoot: root,
      base,
      sources: [{ relativePath: 'fsrs.md', text: 'FSRS models retention.' }],
      completeJson,
    });

    expect(result.concept.title).toBe('FSRS 调度器');
    expect(result.concept.slug).toBe('fsrs-调度器');
    // Wikilinks in the body become traversable outlinks.
    expect(result.concept.links).toEqual(['间隔重复理论']);
    expect(result.sourcePaths).toEqual(['fsrs.md']);

    const stored = await readWikiConcept(root, 'FSRS 调度器');
    expect(stored?.summary).toBe('基于留存率建模的间隔重复调度算法。');
    expect(stored?.tags).toEqual(['fsrs', 'memory']);
    expect(await listWikiConcepts(root)).toHaveLength(1);

    const index = await readWikiIndex(root);
    expect(index).toContain('[[FSRS 调度器]]');
    const log = await readFile(join(root, 'wiki', 'LOG.md'), 'utf8');
    expect(log).toContain('Distilled [[FSRS 调度器]] from fsrs-papers');
  });

  it('passes the retrieved excerpts and the topic to the model', async () => {
    const root = await rootDir();
    const completeJson = vi.fn(async (_input: Parameters<CompleteJsonFn>[0]) => ({
      title: 'T',
      summary: '',
      tags: [],
      content: 'body',
    }));

    await distillWikiConcept({
      piwinRoot: root,
      base,
      sources: [
        { relativePath: 'a.md', text: 'alpha excerpt' },
        { relativePath: 'b.md', text: 'beta excerpt' },
      ],
      topic: '遗忘曲线',
      completeJson,
    });

    const prompt = completeJson.mock.calls[0]?.[0] as { userPrompt: string } | undefined;
    expect(prompt?.userPrompt).toContain('遗忘曲线');
    expect(prompt?.userPrompt).toContain('alpha excerpt');
    expect(prompt?.userPrompt).toContain('b.md');
  });

  it('refuses a source with no indexed slices instead of inventing an entry', async () => {
    const root = await rootDir();
    const completeJson = vi.fn(async () => ({}));

    await expect(
      distillWikiConcept({ piwinRoot: root, base, sources: [], completeJson }),
    ).rejects.toBeInstanceOf(WikiDistillError);
    expect(completeJson).not.toHaveBeenCalled();
  });

  it('rejects a model answer with no usable title or body', async () => {
    const root = await rootDir();
    const completeJson = vi.fn(async () => ({ title: '  ', content: '' }));

    await expect(
      distillWikiConcept({
        piwinRoot: root,
        base,
        sources: [{ relativePath: 'a.md', text: 'x' }],
        completeJson,
      }),
    ).rejects.toBeInstanceOf(WikiDistillError);
    // Nothing half-written on disk.
    expect(await listWikiConcepts(root)).toHaveLength(0);
  });
});
