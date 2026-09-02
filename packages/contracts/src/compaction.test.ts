import { describe, expect, it } from 'vitest';
import { classifyCompactionNoOp, formatCompactionBoundary } from './compaction.js';

describe('compaction message classifiers', () => {
  it('recognizes Pi no-op messages without hiding unrelated failures', () => {
    expect(classifyCompactionNoOp('Nothing to compact (session too small)')).toBe('too-small');
    expect(
      classifyCompactionNoOp('Compaction failed: Nothing to compact (session too small)'),
    ).toBe('too-small');
    expect(classifyCompactionNoOp('Already compacted')).toBe('already-compacted');
    expect(classifyCompactionNoOp('Compaction failed: provider unavailable')).toBeUndefined();
  });

  it('formats the same boundary key for live events and durable replay', () => {
    expect(formatCompactionBoundary({ tokensBefore: 80_000, tokensAfter: 5_000 })).toBe(
      'compact:80000:5000',
    );
    expect(formatCompactionBoundary({})).toBe('compact:na:unknown');
  });
});
