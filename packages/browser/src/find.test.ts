import { describe, expect, it } from 'vitest';
import { BROWSER_FIND_MAX_CANDIDATES, collectFindCandidates } from './find.js';

const TREE = [
  {
    role: 'document',
    children: [
      { role: 'button', name: 'Submit order', ref: 'e3', children: [] },
      { role: 'textbox', name: 'Order note', ref: 'e4', children: [] },
      { role: 'heading', name: 'Order history', children: [] },
      { role: 'link', name: 'Order status', ref: 'e9', children: [] },
    ],
  },
];

describe('collectFindCandidates', () => {
  it('matches case-insensitively and keeps refs', () => {
    const result = collectFindCandidates(TREE, 'order');
    expect(result.count).toBe(4);
    expect(result.truncated).toBe(false);
    expect(result.candidates).toEqual([
      { text: 'Submit order', ref: 'e3' },
      { text: 'Order note', ref: 'e4' },
      { text: 'Order history' },
      { text: 'Order status', ref: 'e9' },
    ]);
  });

  it('does not fabricate a ref for nodes without one', () => {
    const result = collectFindCandidates(TREE, 'history');
    expect(result.candidates).toEqual([{ text: 'Order history' }]);
  });

  it('caps candidates but reports the full count', () => {
    const wide = [
      {
        role: 'document',
        children: Array.from({ length: BROWSER_FIND_MAX_CANDIDATES + 5 }, (_value, index) => ({
          role: 'button',
          name: `Row ${index}`,
          ref: `e${index + 1}`,
          children: [],
        })),
      },
    ];
    const result = collectFindCandidates(wide, 'row');
    expect(result.count).toBe(BROWSER_FIND_MAX_CANDIDATES + 5);
    expect(result.candidates).toHaveLength(BROWSER_FIND_MAX_CANDIDATES);
    expect(result.truncated).toBe(true);
  });

  it('returns nothing for blank input', () => {
    expect(collectFindCandidates(TREE, '   ')).toEqual({
      count: 0,
      candidates: [],
      truncated: false,
    });
  });
});
