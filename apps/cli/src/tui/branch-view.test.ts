import type { TranscriptBranchPoint, TranscriptBranchSibling } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { branchPointItems, branchSiblingItems, describeBranches, describeOffPathWrites } from './branch-view.js';

function sibling(patch: Partial<TranscriptBranchSibling> & { headMessageId: string }): TranscriptBranchSibling {
  return { role: 'user', preview: patch.headMessageId, leafPreview: '', messageCount: 2, writesWorkspace: false, updatedAt: '', ...patch };
}

const promptFork: TranscriptBranchPoint = {
  anchorMessageId: 'a0',
  activeIndex: 1,
  siblings: [
    sibling({ headMessageId: 'u1', preview: '用 Redis 做', messageCount: 6, writesWorkspace: true }),
    sibling({ headMessageId: 'u2', preview: '用 SQLite 做', responseStatus: 'error' }),
  ],
};

const answerVersions: TranscriptBranchPoint = {
  anchorMessageId: 'u9',
  promptPreview: '解释一下这个函数',
  activeIndex: 0,
  siblings: [
    sibling({ headMessageId: 'r1', role: 'assistant', preview: '它先……' }),
    sibling({ headMessageId: 'r2', role: 'assistant', preview: '简单说……', responseStatus: 'interrupted' }),
  ],
};

describe('branch presentation', () => {
  it('names each fork by kind with the active position', () => {
    expect(branchPointItems([promptFork, answerVersions])).toEqual([
      { value: '0', label: '提问分支 2/2', description: '用 SQLite 做' },
      { value: '1', label: '回答版本 1/2', description: '解释一下这个函数' },
    ]);
  });

  it('lists the branches of a fork, marking the current one, failures and file changes', () => {
    expect(branchSiblingItems(promptFork)).toEqual([
      { value: 'u1', label: '1. 用 Redis 做', description: '6 条 · 改过文件' },
      { value: 'u2', label: '2. 用 SQLite 做', description: '当前 · 2 条 · 出错' },
    ]);
    expect(branchSiblingItems(answerVersions)[1]).toEqual({
      value: 'r2',
      label: '2. 简单说……',
      description: '2 条 · 被中断',
    });
  });

  it('says why a branch has no text instead of calling it empty', () => {
    const point: TranscriptBranchPoint = {
      anchorMessageId: 'u9',
      activeIndex: 0,
      siblings: [
        sibling({ headMessageId: 'r1', role: 'assistant', preview: '', responseStatus: 'error' }),
        sibling({ headMessageId: 'r2', role: 'assistant', preview: '', responseStatus: 'interrupted' }),
        sibling({ headMessageId: 'r3', role: 'assistant', preview: '', responseStatus: 'streaming' }),
        sibling({ headMessageId: 'r4', role: 'assistant', preview: '' }),
      ],
    };
    expect(branchSiblingItems(point).map((item) => item.label)).toEqual([
      '1. （出错，没有内容）',
      '2. （被中断，没有内容）',
      '3. （生成中）',
      '4. （空）',
    ]);
  });

  it('shows the fork count only when there are forks', () => {
    expect(describeBranches(0)).toBeUndefined();
    expect(describeBranches(3)).toBe('分支 3');
  });

  it('spells out which file changes a switch leaves behind', () => {
    const files = Array.from({ length: 10 }, (_, index) => `src/f${index}.ts`);
    const text = describeOffPathWrites({ files, hasUnknownWrites: true });
    expect(text.split('\n')).toHaveLength(1 + 8 + 1 + 1);
    expect(text).toContain('…另有 2 个');
    expect(text).toContain('无法逐一列出');
    expect(describeOffPathWrites({ files: ['a.ts'], hasUnknownWrites: false }).split('\n')).toEqual([
      '当前分支改过的文件不会随切换还原，目标分支没见过这些改动：',
      '  a.ts',
    ]);
  });
});
