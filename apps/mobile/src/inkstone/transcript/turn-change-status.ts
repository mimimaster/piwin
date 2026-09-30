/**
 * The one read-only state word next to a mobile turn's change strip.
 * Mobile never undoes; it only says where the turn stands so the user knows
 * to act from the desktop. Refusals of a specific undo click (staged paths,
 * no permission) belong to that click, not to the turn, so they are not here.
 */
import type { TurnChangeSummary } from '@piwin/contracts';

export function describeMobileTurnChangeState(changes: TurnChangeSummary | undefined): string | null {
  if (changes === undefined) return null;
  if (changes.disposition === 'undone') return '已撤销';
  if (changes.captureState === 'expired') return '撤销数据已过期';
  const current = changes.undo.allowed ? null : changes.undo.reason;
  if (current === 'needs-repair') return '需要在桌面端修复';
  if (current === 'workspace-restoring') return '正在撤销或恢复…';
  if (changes.incompleteReason === 'storage-full') return '撤销存储已满，未保存';
  if (changes.captureState === 'incomplete' || (changes.fileCount !== null && !changes.coverageComplete)) {
    return '记录不完整';
  }
  return null;
}
