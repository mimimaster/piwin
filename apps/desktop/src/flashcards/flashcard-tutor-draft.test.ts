import { describe, expect, it } from 'vitest';
import {
  applyDraftEdits,
  basicDraftMissingFrontOrBack,
  buildTutorCreateInput,
  defaultTutorFront,
  outcomeFromBatchCreateData,
  pickDraftAttribution,
  toBatchCreateCard,
  type FlashcardDraftSource,
} from './flashcard-tutor-draft';

const SOURCE_FULL: FlashcardDraftSource = {
  deck: '生物',
  tags: ['植物学'],
  sourceNoteId: 'note-1',
  sourceFolder: '/notes',
  sourceFile: 'photosynthesis.md',
  sourceLine: 12,
  sourceExcerpt: '光合作用是…',
};

describe('flashcard tutor draft defaults', () => {
  it('builds zh and en fronts from the current selection', () => {
    expect(defaultTutorFront('zh-CN', '  光合  ')).toBe('什么是「光合」？');
    expect(defaultTutorFront('en', 'photosynthesis')).toBe('What is “photosynthesis”?');
  });

  it('defaults front/back from selection + explanation and inherits attribution', () => {
    const zh = buildTutorCreateInput({
      locale: 'zh-CN',
      selectedText: '光合',
      explanationMarkdown: '植物把光能变成化学能。',
      source: SOURCE_FULL,
    });
    expect(zh).toEqual({
      model: 'basic',
      front: '什么是「光合」？',
      back: '植物把光能变成化学能。',
      deck: '生物',
      tags: ['植物学'],
      sourceNoteId: 'note-1',
      sourceFolder: '/notes',
      sourceFile: 'photosynthesis.md',
      sourceLine: 12,
      sourceExcerpt: '光合作用是…',
    });
    expect(Object.keys(zh).includes('sourceHash')).toBe(false);

    const en = buildTutorCreateInput({
      locale: 'en',
      selectedText: 'photosynthesis',
      explanationMarkdown: 'Plants convert light into chemical energy.',
      source: SOURCE_FULL,
    });
    expect(en.front).toBe('What is “photosynthesis”?');
    expect(en.back).toBe('Plants convert light into chemical energy.');
  });

  it('omits undefined attribution keys under exactOptionalPropertyTypes', () => {
    const input = buildTutorCreateInput({
      locale: 'zh-CN',
      selectedText: '光合',
      explanationMarkdown: '短讲解',
      source: { deck: 'General' },
    });
    expect(input).toEqual({
      model: 'basic',
      front: '什么是「光合」？',
      back: '短讲解',
      deck: 'General',
    });
    expect('tags' in input).toBe(false);
    expect('sourceNoteId' in input).toBe(false);
    expect('sourceFolder' in input).toBe(false);
    expect('sourceFile' in input).toBe(false);
    expect('sourceLine' in input).toBe(false);
    expect('sourceExcerpt' in input).toBe(false);
    expect(Object.values(input).every((value) => value !== undefined)).toBe(true);
    expect(pickDraftAttribution({ deck: 'General', tags: [] })).toEqual({});
  });

  it('lets user edits win over the default front/back/deck', () => {
    const base = buildTutorCreateInput({
      locale: 'zh-CN',
      selectedText: '光合',
      explanationMarkdown: '默认讲解',
      source: SOURCE_FULL,
    });
    const edited = applyDraftEdits(base, {
      front: '光合作用的定义是什么？',
      back: '用户改过的答案',
      deck: '细胞',
    });
    expect(edited.front).toBe('光合作用的定义是什么？');
    expect(edited.back).toBe('用户改过的答案');
    expect(edited.deck).toBe('细胞');
    expect(edited.tags).toEqual(['植物学']);
    expect(edited.sourceNoteId).toBe('note-1');
    expect(edited.sourceFile).toBe('photosynthesis.md');
  });

  it('rejects empty basic front or back before save', () => {
    expect(basicDraftMissingFrontOrBack({ front: '  ', back: '答案' })).toBe(true);
    expect(basicDraftMissingFrontOrBack({ front: '问题', back: '' })).toBe(true);
    expect(basicDraftMissingFrontOrBack({ front: '问题', back: '答案' })).toBe(false);
  });

  it('trims the one-card batch payload without writing undefined keys', () => {
    const card = toBatchCreateCard({
      model: 'basic',
      front: '  问题  ',
      back: '  答案  ',
      deck: '生物',
      sourceNoteId: 'note-1',
    });
    expect(card).toEqual({
      model: 'basic',
      front: '问题',
      back: '答案',
      deck: '生物',
      sourceNoteId: 'note-1',
    });
    expect('sourceFolder' in card).toBe(false);
  });

  it('maps created / duplicate / validation batch results', () => {
    expect(outcomeFromBatchCreateData({ created: [{ id: 'new' }], skipped: [] }).kind).toBe(
      'created',
    );
    const duplicate = outcomeFromBatchCreateData({
      created: [],
      skipped: [
        {
          front: '什么是「光合」？',
          reason: 'duplicate',
          existing: {
            id: 'old-1',
            model: 'basic',
            deck: '生物',
            front: '已有卡片正面',
            createdAt: '2026-08-18T00:00:00.000Z',
          },
        },
      ],
    });
    expect(duplicate).toEqual({
      kind: 'duplicate',
      existing: {
        id: 'old-1',
        model: 'basic',
        deck: '生物',
        front: '已有卡片正面',
        createdAt: '2026-08-18T00:00:00.000Z',
      },
    });
    expect(outcomeFromBatchCreateData({ created: [], skipped: [{ reason: 'validation', detail: 'blank' }] })).toEqual({
      kind: 'validation',
      detail: 'blank',
    });
  });
});
