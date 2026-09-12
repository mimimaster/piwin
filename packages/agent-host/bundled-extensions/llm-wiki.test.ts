import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import llmWikiExtension, {
  extractWikilinks,
  parseFrontmatter,
  runWikiLint,
  slugify,
  writeConceptFile,
  readConceptFile,
  type RegisteredTool,
} from './llm-wiki.js';

let tempDir: string;
const originalEnv = process.env.PIWIN_ROOT;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'piwin-wiki-ext-'));
  process.env.PIWIN_ROOT = tempDir;
});

afterEach(async () => {
  if (originalEnv !== undefined) {
    process.env.PIWIN_ROOT = originalEnv;
  } else {
    delete process.env.PIWIN_ROOT;
  }
  await rm(tempDir, { recursive: true, force: true });
});

function getRegisteredTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  llmWikiExtension({ registerTool: (t) => tools.push(t) });
  return tools;
}

describe('bundled llm-wiki extension (Karpathy LLM-Wiki)', () => {
  it('registers wiki_read, wiki_write, and wiki_lint tools', () => {
    const tools = getRegisteredTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('wiki_read');
    expect(names).toContain('wiki_write');
    expect(names).toContain('wiki_lint');
  });

  it('slugify handles unicode and symbols properly', () => {
    expect(slugify('Transformer Architecture')).toBe('transformer-architecture');
    expect(slugify('Deep Learning 101!')).toBe('deep-learning-101');
    expect(slugify('注意力机制 (Attention)')).toBe('注意力机制-attention');
  });

  it('extracts wikilinks with or without pipe alias', () => {
    const text = 'See [[Transformer]] and [[Self-Attention|self attention mechanism]] for more.';
    const links = extractWikilinks(text);
    expect(links).toEqual(['Transformer', 'Self-Attention']);
  });

  it('parses frontmatter correctly', () => {
    const raw = `---
title: Transformer
tags: [nlp, deep-learning]
---
# Transformer Content`;
    const { meta, body } = parseFrontmatter(raw);
    expect(meta.title).toBe('Transformer');
    expect(meta.tags).toEqual(['nlp', 'deep-learning']);
    expect(body).toBe('# Transformer Content');
  });

  it('writes concept file, updates INDEX.md, and writes to LOG.md', async () => {
    const wikiDir = join(tempDir, 'wiki');
    const result = await writeConceptFile(wikiDir, {
      title: 'Attention Mechanism',
      content: 'The core of [[Transformer Architecture]] is self-attention.',
      summary: 'Mechanism computing weighted representation of sequence elements',
      tags: ['deep-learning', 'nlp'],
      logMessage: 'Initial creation of concept',
    });

    expect(result.slug).toBe('attention-mechanism');
    expect(result.links).toEqual(['Transformer Architecture']);

    const read = await readConceptFile(wikiDir, 'Attention Mechanism');
    expect(read).not.toBeNull();
    expect(read?.title).toBe('Attention Mechanism');
    expect(read?.links).toContain('Transformer Architecture');
  });

  it('executes wiki_write and wiki_read tools via extension', async () => {
    const tools = getRegisteredTools();
    const writeTool = tools.find((t) => t.name === 'wiki_write')!;
    const readTool = tools.find((t) => t.name === 'wiki_read')!;

    // Write a concept
    const writeRes = await writeTool.execute('call-w1', {
      title: 'Backpropagation',
      content: 'Algorithm for gradient computation in [[Neural Networks]].',
      summary: 'Gradient descent optimization technique',
      tags: ['calculus', 'neural-nets'],
    });
    expect(writeRes.content[0]?.text).toContain('Saved concept [[Backpropagation]]');

    // Read the concept
    const readRes = await readTool.execute('call-r1', {
      name: 'Backpropagation',
    });
    expect(readRes.content[0]?.text).toContain('# Backpropagation');
    expect(readRes.content[0]?.text).toContain('[[Neural Networks]]');

    // Read INDEX
    const indexRes = await readTool.execute('call-r2', { name: 'INDEX' });
    expect(indexRes.content[0]?.text).toContain('Backpropagation');

    // Read LOG
    const logRes = await readTool.execute('call-r3', { name: 'LOG' });
    expect(logRes.content[0]?.text).toContain('Updated concept [[Backpropagation]]');
  });

  it('runs wiki_lint and detects broken links', async () => {
    const wikiDir = join(tempDir, 'wiki');
    await writeConceptFile(wikiDir, {
      title: 'Transformer',
      content: 'Uses [[Self-Attention]] and [[Non-Existent-Concept]].',
    });
    await writeConceptFile(wikiDir, {
      title: 'Self-Attention',
      content: 'Calculates dot product between Query and Key.',
    });

    const report = await runWikiLint(wikiDir);
    expect(report.totalConcepts).toBe(2);
    expect(report.brokenLinks.some((b) => b.target === 'Non-Existent-Concept')).toBe(true);
    expect(report.healthy).toBe(false);
  });
});
