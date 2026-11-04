// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearKnowledgeReaderReturn,
  readKnowledgeReaderReturn,
  rememberKnowledgeReaderReturn,
} from './knowledge-reader-return.js';

afterEach(() => {
  clearKnowledgeReaderReturn();
});

describe('knowledge-reader-return', () => {
  it('round-trips a cited document so the workspace can reopen it', () => {
    rememberKnowledgeReaderReturn({
      baseId: 'base-1',
      relativePath: 'notes/sleep-debt.md',
      title: 'sleep-debt.md',
      indexed: false,
      chunkCount: 0,
      assistSessionId: 'assist-1',
    });
    expect(readKnowledgeReaderReturn()).toEqual({
      baseId: 'base-1',
      relativePath: 'notes/sleep-debt.md',
      title: 'sleep-debt.md',
      indexed: false,
      chunkCount: 0,
      assistSessionId: 'assist-1',
    });
  });

  it('ignores a truncated payload instead of throwing', () => {
    sessionStorage.setItem('piwin:knowledge-reader-return', '{');
    expect(readKnowledgeReaderReturn()).toBeNull();
  });
});
