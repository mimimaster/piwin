import { describe, expect, it } from 'vitest';
import { flashcardStudyCopy, flashcardStudyErrorMessage } from './study-copy';

describe('flashcardStudyCopy', () => {
  it('keeps sequence browse copy and scheduled due labels without mastery language', () => {
    const zh = flashcardStudyCopy('zh-CN');
    expect(zh.next).toBe('下一张');
    expect(zh.lastCard).toBe('结束浏览');
    expect(zh.due).toBe('待复习');
    expect(zh.sequenceCompleted(3, 1)).toBe('已浏览 3 张，需再看 1 张');
    expect(zh.scheduledCompleted(4)).toBe('本轮已复习 4 题');
    const blob = JSON.stringify(zh);
    expect(blob).not.toMatch(/撕掉/);
    expect(blob).not.toMatch(/掌握/);
  });

  it('does not surface Host kebab-case codes in the study chrome', () => {
    const zh = flashcardStudyCopy('zh-CN');
    expect(
      flashcardStudyErrorMessage(
        { code: 'idempotency-key-required', message: 'idempotency-key-required' },
        zh,
      ),
    ).toBe(zh.keyRequired);
    expect(
      flashcardStudyErrorMessage({ code: 'study-stale-epoch', message: 'study-stale-epoch' }, zh),
    ).toBe(zh.genericError);
    expect(
      flashcardStudyErrorMessage({ code: 'study-error', message: '卡组已删除' }, zh),
    ).toBe('卡组已删除');
  });
});
