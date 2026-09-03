import { BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX } from '@piwin/contracts';
import { showErrorNotification } from '@piwin/ui-kit';
import { getDesktopCopy } from './desktop-locale';

export function worktreeFolderName(worktreePath: string): string {
  const trimmed = worktreePath.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || worktreePath;
}

export function localizeCheckoutError(
  message: string,
  copy: ReturnType<typeof getDesktopCopy>['composer'],
): string {
  const prefix = `${BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX} `;
  if (message.startsWith(prefix)) {
    return copy.branchOccupiedToast(worktreeFolderName(message.slice(prefix.length).trim()));
  }
  return message;
}

export function reportBranchChipError(
  message: string,
  onError: ((message: string) => void) | undefined,
): void {
  if (onError) {
    onError(message);
    return;
  }
  try {
    showErrorNotification(message);
  } catch {
    // Headless tests / no notification provider.
  }
}
