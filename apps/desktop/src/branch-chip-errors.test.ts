import { describe, expect, it } from 'vitest';
import {
  BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX,
  CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX,
} from '@piwin/contracts';
import { localizeCheckoutError } from './branch-chip-errors';
import { getDesktopCopy } from './desktop-locale';

const zh = getDesktopCopy('zh-CN').composer;
const en = getDesktopCopy('en').composer;

describe('localizeCheckoutError', () => {
  it('localizes worktree occupancy for Chinese and English', () => {
    const message = `${BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX} /Volumes/BigDisk/piwin-cc`;
    expect(localizeCheckoutError(message, zh)).toBe('该分支已在工作区「piwin-cc」检出');
    expect(localizeCheckoutError(message, en)).toBe(
      'This branch is already checked out in “piwin-cc”',
    );
  });

  it('localizes a classified local-changes block without dumping paths', () => {
    expect(localizeCheckoutError(CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX, zh)).toBe(
      '工作区有未提交更改，无法切换分支。请先提交或贮藏后再试。',
    );
    expect(localizeCheckoutError(CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX, en)).toBe(
      'Uncommitted changes would be overwritten. Commit or stash them, then try again.',
    );
  });

  it('localizes raw git overwrite stderr as a fallback', () => {
    const raw =
      'Your local changes to the following files would be overwritten by checkout:\n    apps/desktop/src/styles/transcript.css';
    expect(localizeCheckoutError(raw, zh)).toBe(
      '工作区有未提交更改，无法切换分支。请先提交或贮藏后再试。',
    );
  });

  it('does not dump a long unclassified git error into the toast', () => {
    const wall = Array.from({ length: 20 }, (_, index) => `apps/desktop/src/file-${index}.ts`).join(
      ' ',
    );
    expect(localizeCheckoutError(wall, zh)).toBe('无法切换分支。');
  });
});
