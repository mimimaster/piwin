import type { SelectItem } from '@earendil-works/pi-tui';
import type { TranscriptBranchPoint, TranscriptBranchSibling, WorkspaceWrites } from '@piwin/contracts';
import { isAnswerVariantPoint } from '@piwin/contracts';

/**
 * The conversation tree as the TUI offers it: one row per fork along the
 * active path, then that fork's branches. Pure — the Host owns the tree.
 */

const PREVIEW_CHARS = 48;
const MAX_LISTED_FILES = 8;

function oneLine(text: string | undefined, fallback: string): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return fallback;
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

export function describeBranches(branchPointCount: number): string | undefined {
  return branchPointCount === 0 ? undefined : `分支 ${branchPointCount}`;
}

/** One row per fork; the value is the fork's index in the Host's list. */
export function branchPointItems(points: readonly TranscriptBranchPoint[]): SelectItem[] {
  return points.map((point, index) => {
    const answers = isAnswerVariantPoint(point);
    const kind = answers ? '回答版本' : '提问分支';
    const active = point.siblings[point.activeIndex]?.preview;
    // Answer versions share one prompt; prompt forks are told apart by the active one.
    const subject = answers ? (point.promptPreview ?? active) : (active ?? point.promptPreview);
    return {
      value: String(index),
      label: `${kind} ${point.activeIndex + 1}/${point.siblings.length}`,
      description: oneLine(subject, '（无预览）'),
    };
  });
}

/** One row per branch of a fork; the value is the message a switch targets. */
export function branchSiblingItems(point: TranscriptBranchPoint): SelectItem[] {
  return point.siblings.map((sibling, index) => ({
    value: sibling.headMessageId,
    label: `${index + 1}. ${oneLine(headline(point, sibling), emptyBranchLabel(sibling))}`,
    description: describeSibling(sibling, index === point.activeIndex),
  }));
}

/** An answer version is told apart by its answer; a prompt fork by its prompt. */
function headline(point: TranscriptBranchPoint, sibling: TranscriptBranchSibling): string {
  return isAnswerVariantPoint(point) ? sibling.preview : sibling.preview || (sibling.responsePreview ?? '');
}

/** A branch whose turn never produced text says why instead of looking empty. */
function emptyBranchLabel(sibling: TranscriptBranchSibling): string {
  switch (sibling.responseStatus) {
    case 'error':
      return '（出错，没有内容）';
    case 'interrupted':
      return '（被中断，没有内容）';
    case 'streaming':
      return '（生成中）';
    default:
      return '（空）';
  }
}

function describeSibling(sibling: TranscriptBranchSibling, active: boolean): string {
  const status =
    sibling.responseStatus === 'error'
      ? '出错'
      : sibling.responseStatus === 'interrupted'
        ? '被中断'
        : sibling.responseStatus === 'streaming'
          ? '生成中'
          : undefined;
  return [
    active ? '当前' : undefined,
    `${sibling.messageCount} 条`,
    status,
    // Switching away from a branch that changed files leaves those changes on disk.
    sibling.writesWorkspace ? '改过文件' : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
}

/** What the user is told before a switch that strands file changes. */
export function describeOffPathWrites(writes: WorkspaceWrites): string {
  const listed = writes.files.slice(0, MAX_LISTED_FILES);
  const more = writes.files.length - listed.length;
  return [
    '当前分支改过的文件不会随切换还原，目标分支没见过这些改动：',
    ...listed.map((file) => `  ${file}`),
    ...(more > 0 ? [`  …另有 ${more} 个`] : []),
    ...(writes.hasUnknownWrites ? ['  以及通过命令做的、无法逐一列出的改动'] : []),
  ].join('\n');
}
