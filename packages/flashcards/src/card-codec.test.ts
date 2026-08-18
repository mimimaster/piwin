import { describe, expect, it } from 'vitest';
import type { FlashcardItem } from '@piwin/contracts';
import { decodeCardMarkdown, encodeCardMarkdown } from './card-codec.js';

const OLD_CARD_MARKDOWN = `---
id: "card-old-1"
deck: "srs"
sourceFolder: "/docs"
sourceFile: "a.md"
sourceLine: 3
createdAt: "2026-01-01T00:00:00.000Z"
---

## Front

什么是间隔重复？

## Back

按遗忘曲线安排复习。

## Source

> 摘录
`;

function lineageCard(): FlashcardItem {
  return {
    id: 'card-new-1',
    model: 'basic',
    deck: 'Notes',
    front: 'What is RAG?',
    back: 'Retrieval-Augmented Generation.',
    createdAt: '2026-08-16T00:00:00.000Z',
    sourceFolder: '/docs/Notes',
    sourceFile: 'intro.md',
    sourceLine: 4,
    sourceExcerpt: 'RAG combines retrieval with generation.',
    sequenceId: 'seq_gen1',
    position: 2,
    cardType: 'definition',
    relationFromPrevious: 'elaborates',
    knowledgePointIds: ['kp_gen1_1'],
    sourceChunkIds: ['chk1'],
    generationId: 'gen1',
    sourceDocumentIds: ['doc1'],
  };
}

describe('card-codec lineage fields', () => {
  it('decodes a legacy card that has no sequence fields', () => {
    const card = decodeCardMarkdown(OLD_CARD_MARKDOWN);
    expect(card).toMatchObject({
      id: 'card-old-1',
      model: 'basic',
      deck: 'srs',
      front: '什么是间隔重复？',
      back: '按遗忘曲线安排复习。',
      sourceFolder: '/docs',
      sourceFile: 'a.md',
      sourceLine: 3,
      sourceExcerpt: '摘录',
    });
    expect(card?.sequenceId).toBeUndefined();
    expect(card?.position).toBeUndefined();
    expect(card?.generationId).toBeUndefined();
  });

  it('round-trips optional sequence and lineage fields', () => {
    const encoded = encodeCardMarkdown(lineageCard());
    expect(encoded).toContain('sequenceId: "seq_gen1"');
    expect(encoded).toContain('position: 2');
    const decoded = decodeCardMarkdown(encoded);
    expect(decoded).toEqual(lineageCard());
  });

  it('omits absent optional fields from frontmatter', () => {
    const encoded = encodeCardMarkdown({
      id: 'card-min',
      model: 'basic',
      deck: 'd',
      front: 'q',
      back: 'a',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(encoded).not.toContain('sequenceId');
    expect(encoded).not.toContain('position');
    expect(encoded).not.toContain('generationId');
    expect(encoded).toContain('model: "basic"');
  });

  it('round-trips a cloze item through ## Text and keeps markers', () => {
    const item: FlashcardItem = {
      id: 'cloze-1',
      model: 'cloze',
      deck: 'bio',
      text: '线粒体是{{c1::细胞}}的{{c2::能量工厂::提示}}。',
      createdAt: '2026-08-18T00:00:00.000Z',
      tags: ['cell'],
    };
    const encoded = encodeCardMarkdown(item);
    expect(encoded).toContain('model: "cloze"');
    expect(encoded).toContain('## Text');
    expect(encoded).not.toContain('## Front');
    const decoded = decodeCardMarkdown(encoded);
    expect(decoded).toEqual(item);
  });
});
