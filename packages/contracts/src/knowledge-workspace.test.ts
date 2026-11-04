import { describe, expect, it } from 'vitest';
import {
  hostSupportsKnowledgeWorkspace,
  knowledgeContentKindOf,
  type KnowledgeContentId,
} from './knowledge-workspace.js';

describe('knowledge workspace capability', () => {
  it('treats a missing flag as an old Host, not a crash', () => {
    expect(hostSupportsKnowledgeWorkspace({ knowledgeWorkspace: true })).toBe(true);
    expect(hostSupportsKnowledgeWorkspace({})).toBe(false);
    expect(hostSupportsKnowledgeWorkspace(undefined)).toBe(false);
  });

  it('keeps content identity separate from the display title', () => {
    const material: KnowledgeContentId = {
      kind: 'material',
      baseId: 'folder:abc',
      relativePath: '极限的定义.md',
    };
    expect(knowledgeContentKindOf(material)).toBe('material');
  });
});
