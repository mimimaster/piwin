import { describe, expect, it } from 'vitest';
import type { FlashcardRecord } from '@piwin/contracts';
import { buildFlashcardArtifactHtml } from './artifact-template.js';

function makeCard(overrides?: Partial<FlashcardRecord>): FlashcardRecord {
  return {
    id: 'card-abc12345-xyz',
    deck: 'srs',
    front: '什么是 FSRS？',
    back: '一种间隔重复调度算法。',
    createdAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildFlashcardArtifactHtml', () => {
  it('embeds card content and posts the whitelisted rate action', () => {
    const html = buildFlashcardArtifactHtml(makeCard());
    expect(html).toContain('什么是 FSRS？');
    expect(html).toContain('一种间隔重复调度算法。');
    expect(html).toContain("postAction('flashcard/rate'");
    expect(html).toContain("cardId: 'card-abc12345-xyz'");
    for (const rating of ['again', 'hard', 'good', 'easy']) {
      expect(html).toContain(`'${rating}'`);
    }
  });

  it('escapes HTML in card content (XSS guard)', () => {
    const html = buildFlashcardArtifactHtml(
      makeCard({ front: '<script>alert(1)</script>', back: '"><img src=x>' }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('"><img src=x>');
  });

  it('uses only theme variables, no external resources', () => {
    const html = buildFlashcardArtifactHtml(makeCard());
    expect(html).toContain('var(--piwin-artifact-surface)');
    expect(html).not.toMatch(/https?:\/\//);
  });
});
