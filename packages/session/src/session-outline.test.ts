import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { buildSessionOutline } from './session-outline.js';

describe('buildSessionOutline', () => {
  it('maps messages to outline nodes with truncated preview', () => {
    const longText = 'word '.repeat(40).trim();
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'm1',
        role: 'user',
        text: longText,
        createdAt: '2026-07-20T00:00:00.000Z',
        status: 'done',
      },
      {
        id: 'm2',
        role: 'assistant',
        text: '  short reply  ',
        createdAt: '2026-07-20T00:00:01.000Z',
        status: 'done',
      },
    ];
    const outline = buildSessionOutline(messages);
    expect(outline).toHaveLength(2);
    expect(outline[0]?.id).toBe('m1');
    expect(outline[0]?.preview.endsWith('…')).toBe(true);
    expect(outline[0]?.preview.length).toBeLessThanOrEqual(120);
    expect(outline[1]?.preview).toBe('short reply');
  });

  it('returns empty outline for empty transcript', () => {
    expect(buildSessionOutline([])).toEqual([]);
  });
});
