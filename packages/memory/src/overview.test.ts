import { describe, expect, it } from 'vitest';
import type { MemoryRecord } from '@piwin/contracts';
import { MEMORY_OVERVIEW_HEADER } from './constants.js';
import { buildOverviewText } from './overview.js';

function record(partial: Partial<MemoryRecord> & Pick<MemoryRecord, 'id' | 'content'>): MemoryRecord {
  return {
    scope: 'global',
    type: 'user',
    confidence: 'medium',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...partial,
  };
}

describe('buildOverviewText', () => {
  it('includes header and ranks high first', () => {
    const text = buildOverviewText({
      globalRecords: [
        record({ id: 'low1', content: 'low fact', confidence: 'low', title: 'Low' }),
        record({ id: 'high1', content: 'high fact', confidence: 'high', title: 'High' }),
      ],
      projectRecords: [],
    });
    expect(text.startsWith(MEMORY_OVERVIEW_HEADER)).toBe(true);
    expect(text.indexOf('High')).toBeLessThan(text.indexOf('Low'));
  });

  it('lets project shadow global by id', () => {
    const text = buildOverviewText({
      globalRecords: [
        record({ id: 'same', content: 'global', title: 'Global Title', confidence: 'high' }),
      ],
      projectRecords: [
        record({
          id: 'same',
          scope: 'project',
          projectKey: 'p1',
          content: 'project',
          title: 'Project Title',
          confidence: 'high',
        }),
      ],
    });
    expect(text).toContain('Project Title');
    expect(text).not.toContain('Global Title');
  });

  it('truncates when over maxChars', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      record({
        id: `id-${index}`,
        content: `content-${index}-${'x'.repeat(80)}`,
        title: `Title ${index} ${'y'.repeat(40)}`,
        confidence: 'medium',
      }),
    );
    const text = buildOverviewText({
      globalRecords: many,
      projectRecords: [],
      maxChars: 200,
    });
    expect(text.length).toBeLessThanOrEqual(220);
    expect(text).toContain('truncated');
  });
});
