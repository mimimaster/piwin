import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextPack, GeneratedFlashcard } from '@piwin/contracts';
import {
  assignPositions,
  buildSinglePassPrompt,
  parseDraftCardsJson,
  toFlashcardCreateInputs,
  writeGenerationRecord,
} from './generation-service.js';

const pack: ContextPack = {
  query: 'srs',
  folderKey: 'folder1',
  retrievalMode: 'fts_only',
  degraded: true,
  sources: [
    {
      chunkId: 'chk-1',
      documentId: 'doc-1',
      relativePath: 'srs.md',
      text: 'Spaced repetition schedules reviews.',
      startLine: 3,
      endLine: 5,
      retrievedBy: 'fts',
    },
  ],
};

describe('generation-service', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('parses a JSON array even when wrapped in prose', () => {
    const cards = parseDraftCardsJson(
      'Here you go:\n[{"front":"Q","back":"A","cardType":"fact","sourceChunkIds":["chk-1"]}]\nThanks',
    );
    expect(cards).toEqual([
      {
        position: 1,
        front: 'Q',
        back: 'A',
        cardType: 'fact',
        knowledgePointIds: [],
        sourceChunkIds: ['chk-1'],
      },
    ]);
  });

  it('assignPositions is 1-based and drops relationFromPrevious on the first card', () => {
    const cards: GeneratedFlashcard[] = [
      {
        position: 99,
        front: 'First',
        back: 'A',
        cardType: 'fact',
        relationFromPrevious: 'should-go',
        knowledgePointIds: [],
        sourceChunkIds: [],
      },
      {
        position: 0,
        front: 'Second',
        back: 'B',
        cardType: 'fact',
        relationFromPrevious: 'builds-on',
        knowledgePointIds: [],
        sourceChunkIds: [],
      },
    ];
    expect(assignPositions(cards)).toEqual([
      {
        position: 1,
        front: 'First',
        back: 'A',
        cardType: 'fact',
        knowledgePointIds: [],
        sourceChunkIds: [],
      },
      {
        position: 2,
        front: 'Second',
        back: 'B',
        cardType: 'fact',
        relationFromPrevious: 'builds-on',
        knowledgePointIds: [],
        sourceChunkIds: [],
      },
    ]);
  });

  it('toFlashcardCreateInputs writes lineage and folder attribution', () => {
    const [input] = toFlashcardCreateInputs({
      cards: [
        {
          position: 1,
          front: 'What is SRS?',
          back: 'A review schedule.',
          cardType: 'definition',
          knowledgePointIds: [],
          sourceChunkIds: ['chk-1'],
        },
      ],
      folderPath: '/docs/Notes',
      generationId: 'gen_1',
      sequenceId: 'seq_gen_1',
      deck: 'Notes',
      pack,
    });
    expect(input).toMatchObject({
      deck: 'Notes',
      front: 'What is SRS?',
      back: 'A review schedule.',
      sourceFolder: '/docs/Notes',
      sourceFile: 'srs.md',
      sourceLine: 3,
      sequenceId: 'seq_gen_1',
      position: 1,
      cardType: 'definition',
      generationId: 'gen_1',
      sourceChunkIds: ['chk-1'],
    });
  });

  it('buildSinglePassPrompt includes topic, rules, and excerpts', () => {
    const prompt = buildSinglePassPrompt({
      topic: '间隔重复',
      workspaceName: 'Notes',
      pack,
      existingFronts: ['Old front'],
      qualityRules: 'Keep cards atomic.',
    });
    expect(prompt).toContain('Workspace: Notes');
    expect(prompt).toContain('Topic: 间隔重复');
    expect(prompt).toContain('Keep cards atomic.');
    expect(prompt).toContain('srs.md');
    expect(prompt).toContain('Old front');
  });

  it('writeGenerationRecord does not store secrets', async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-gen-rec-'));
    await writeGenerationRecord({
      flashcardsRoot: root,
      generationId: 'gen_abc',
      folderKey: 'fk',
      query: 'srs',
      includeFiles: ['srs.md'],
      sequenceId: 'seq_gen_abc',
      createdCardIds: ['card-1'],
      retrievalMode: 'fts_only',
      degraded: true,
    });
    const raw = await readFile(join(root, 'generations', 'gen_abc.json'), 'utf8');
    expect(raw).not.toMatch(/sk-|api[_-]?key|token/i);
    expect(JSON.parse(raw)).toMatchObject({
      id: 'gen_abc',
      sequenceId: 'seq_gen_abc',
      createdCardIds: ['card-1'],
      pipelineVersion: 'v2-single-llm-legacy',
    });
  });
});
