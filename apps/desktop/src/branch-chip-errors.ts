import {
  BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX,
  CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX,
  worktreeFolderName,
} from '@piwin/contracts';
import { showErrorNotification } from '@piwin/ui-kit';
import { getDesktopCopy } from './desktop-locale';

const LOCAL_CHANGES_OVERWRITE_PATTERN = /would be overwritten by checkout/i;
const COMPACT_ERROR_LIMIT = 160;

export { worktreeFolderName };

export function localizeCheckoutError(
  message: string,
  copy: ReturnType<typeof getDesktopCopy>['composer'],
): string {
  const occupiedPrefix = `${BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX} `;
  if (message.startsWith(occupiedPrefix)) {
    return copy.branchOccupiedToast(worktreeFolderName(message.slice(occupiedPrefix.length).trim()));
  }
  if (
    message === CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX ||
    message.startsWith(`${CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX} `) ||
    LOCAL_CHANGES_OVERWRITE_PATTERN.test(message)
  ) {
    return copy.branchCheckoutBlockedByLocalChanges;
  }
  const compact = message.replace(/\s+/g, ' ').trim();
  if (compact.length === 0 || compact.length > COMPACT_ERROR_LIMIT) {
    return copy.branchCheckoutFailed;
  }
  return compact;
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
