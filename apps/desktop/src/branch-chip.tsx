/**
 * Plain-text branch switcher above the composer input.
 * Dropdown matches Cursor-style: search + clean list + check on current.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type {
  GitBranchList,
  GitBranchListEntry,
  GitStatusSnapshot,
  HostResponse,
} from '@piwin/contracts';
import { DropdownMenu, DropdownMenuItem } from '@piwin/ui-kit';
import { useConfirmDialog } from './use-confirm-dialog';
import { useDesktopLocale } from './desktop-locale-context';
import { getDesktopCopy } from './desktop-locale';
import { IconChevronDown, IconGit } from './shell-icons';
import {
  localizeCheckoutError,
  reportBranchChipError,
  worktreeFolderName,
} from './branch-chip-errors';

export type BranchChipRequest =
  | { type: 'git/status'; projectPath: string }
  | { type: 'git/branch-list'; projectPath: string; limit?: number }
  | { type: 'git/checkout'; input: { projectPath: string; ref: string } };

export type BranchChipProps = {
  projectPath: string | null;
  /** When true, hide switch actions (e.g. agent is streaming). */
  disabled?: boolean;
  request: (command: BranchChipRequest) => Promise<HostResponse>;
  /** Occupied-branch navigation: open that worktree as a project and start/resume a session. */
  onOpenWorktreeProject?: (worktreePath: string) => void | Promise<void>;
  /** Test seam; production toasts via ui-kit when omitted. */
  onError?: (message: string) => void;
};

function branchLabel(snapshot: GitStatusSnapshot | null, fallback: string): string {
  if (!snapshot?.repository.isRepository) {
    return fallback;
  }
  const branch = snapshot.branch;
  if (!branch) {
    return fallback;
  }
  if (branch.isDetached) {
    const short = branch.headCommit?.slice(0, 7) ?? '?';
    return `HEAD ${short}`;
  }
  return branch.currentBranch?.trim() || fallback;
}

function filterBranches(
  branches: GitBranchListEntry[],
  query: string,
): GitBranchListEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return branches;
  }
  return branches.filter((entry) => entry.name.toLowerCase().includes(trimmed));
}

export function BranchChip(props: BranchChipProps): ReactElement | null {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).composer;
  const confirmDialog = useConfirmDialog();
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [branches, setBranches] = useState<GitBranchListEntry[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const projectPath = props.projectPath?.trim() || null;
  const disabled = props.disabled === true || switching;
  const request = props.request;

  const filteredBranches = useMemo(
    () => filterBranches(branches, searchQuery),
    [branches, searchQuery],
  );

  const reloadStatus = useCallback(async (): Promise<void> => {
    if (!projectPath) {
      setStatus(null);
      setError(null);
      return;
    }
    const response = await request({ type: 'git/status', projectPath });
    if (!response.success) {
      setStatus(null);
      setError(response.error);
      return;
    }
    const snapshot = (response.data as { snapshot?: GitStatusSnapshot } | undefined)?.snapshot;
    setStatus(snapshot ?? null);
    setError(null);
  }, [projectPath, request]);

  useEffect(() => {
    void reloadStatus();
  }, [reloadStatus]);

  const loadBranches = useCallback(async (): Promise<void> => {
    if (!projectPath) {
      setBranches([]);
      return;
    }
    setLoadingList(true);
    setError(null);
    const response = await request({
      type: 'git/branch-list',
      projectPath,
      limit: 80,
    });
    setLoadingList(false);
    if (!response.success) {
      setBranches([]);
      setError(response.error);
      return;
    }
    const list = (response.data as { branches?: GitBranchList } | undefined)?.branches;
    setBranches(list?.branches ?? []);
  }, [projectPath, request]);

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (disabled && open) {
        return;
      }
      setMenuOpen(open);
      if (open) {
        setSearchQuery('');
        void loadBranches().then(() => {
          // Focus search after list paints.
          window.setTimeout(() => {
            searchInputRef.current?.focus();
          }, 0);
        });
      } else {
        setSearchQuery('');
      }
    },
    [disabled, loadBranches],
  );

  const handleCheckout = useCallback(
    async (branchName: string): Promise<void> => {
      if (!projectPath || disabled) {
        return;
      }
      const current = status?.branch?.currentBranch;
      if (current && current === branchName) {
        setMenuOpen(false);
        return;
      }

      const selected = branches.find((entry) => entry.name === branchName);
      const occupiedPath = selected?.checkedOutWorktreePath;
      if (occupiedPath) {
        setMenuOpen(false);
        if (selected?.checkedOutWorktreeMissing === true) {
          const message = copy.branchOccupiedUnreachable(occupiedPath);
          setError(message);
          reportBranchChipError(message, props.onError);
          return;
        }
        const folderName = worktreeFolderName(occupiedPath);
        const confirmed = await confirmDialog.confirm({
          title: copy.branchOccupiedConfirmTitle,
          description: copy.branchOccupiedConfirm(branchName, folderName),
          confirmLabel: copy.branchOccupiedAction,
          tone: 'default',
        });
        if (!confirmed) {
          return;
        }
        if (!props.onOpenWorktreeProject) {
          const message = copy.branchOccupiedToast(folderName);
          setError(message);
          reportBranchChipError(message, props.onError);
          return;
        }
        setSwitching(true);
        setError(null);
        await props.onOpenWorktreeProject(occupiedPath);
        setSwitching(false);
        return;
      }

      const dirty = status?.branch?.dirty === true;
      const description = dirty
        ? copy.branchCheckoutDirtyConfirm(branchName)
        : copy.branchCheckoutConfirm(branchName);
      const confirmed = await confirmDialog.confirm({
        title: copy.branchCheckoutTitle,
        description,
        confirmLabel: copy.branchCheckoutAction,
        tone: dirty ? 'danger' : 'default',
      });
      if (!confirmed) {
        return;
      }

      setSwitching(true);
      setError(null);
      const response = await request({
        type: 'git/checkout',
        input: { projectPath, ref: branchName },
      });
      setSwitching(false);
      if (!response.success) {
        const message = localizeCheckoutError(response.error, copy);
        setError(message);
        reportBranchChipError(message, props.onError);
        return;
      }
      setMenuOpen(false);
      await reloadStatus();
    },
    [
      branches,
      confirmDialog,
      copy,
      disabled,
      projectPath,
      props.onError,
      props.onOpenWorktreeProject,
      request,
      reloadStatus,
      status,
    ],
  );

  const handleSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>): void => {
    // Keep typing inside the menu; do not let Radix treat keys as item nav only.
    event.stopPropagation();
    if (event.key === 'Escape') {
      setMenuOpen(false);
    }
  }, []);

  if (!projectPath) {
    return null;
  }

  const isRepo = status?.repository.isRepository === true;
  const label = branchLabel(status, copy.branchUnknown);
  const dirty = status?.branch?.dirty === true;
  const triggerTitle = error
    ? error
    : isRepo
      ? dirty
        ? copy.branchDirtyTooltip(label)
        : copy.branchTooltip(label)
      : copy.branchNotRepo;

  return (
    <>
      {confirmDialog.dialog}
      <DropdownMenu
        open={menuOpen}
        onOpenChange={handleOpenChange}
        modal={false}
        align="start"
        side="bottom"
        contentClassName="branch-picker-menu"
        testId="branch-chip-menu"
        label={copy.branchMenuLabel}
        trigger={
          <button
            type="button"
            className={`composer-context-link${dirty ? ' is-dirty' : ''}${!isRepo ? ' is-disabled' : ''}`}
            data-testid="composer-branch-chip"
            disabled={disabled || !isRepo}
            title={triggerTitle}
            aria-label={triggerTitle}
          >
            <span className="composer-context-link-icon" aria-hidden>
              <IconGit width={13} height={13} />
            </span>
            <span className="composer-context-link-label">{label}</span>
            <span className="composer-context-link-caret" aria-hidden>
              <IconChevronDown width={13} height={13} />
            </span>
          </button>
        }
      >
        <div
          className="branch-picker-search"
          onPointerDown={(event) => {
            // Prevent Radix from treating search as a menu dismiss target.
            event.stopPropagation();
          }}
        >
          <input
            ref={searchInputRef}
            type="text"
            className="branch-picker-search-input"
            data-testid="branch-chip-search"
            value={searchQuery}
            placeholder={copy.branchSearchPlaceholder}
            disabled={loadingList}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </div>

        <div className="branch-picker-list" role="listbox" aria-label={copy.branchMenuLabel}>
          {loadingList ? (
            <div className="branch-picker-empty" data-testid="branch-chip-loading">
              {copy.branchLoading}
            </div>
          ) : null}

          {!loadingList && filteredBranches.length === 0 ? (
            <div className="branch-picker-empty" data-testid="branch-chip-empty">
              {searchQuery.trim() ? copy.branchSearchEmpty : copy.branchEmpty}
            </div>
          ) : null}

          {!loadingList
            ? filteredBranches.map((entry) => (
                <DropdownMenuItem
                  key={entry.name}
                  disabled={disabled}
                  testId={`branch-chip-item-${entry.name}`}
                  onSelect={() => {
                    void handleCheckout(entry.name);
                  }}
                >
                  <span
                    className={`branch-picker-item${entry.current ? ' is-current' : ''}${entry.checkedOutWorktreePath ? ' is-occupied' : ''}`}
                  >
                    <span className="branch-picker-item-name">{entry.name}</span>
                    {entry.current ? (
                      <span className="branch-picker-item-check" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                    {entry.checkedOutWorktreePath ? (
                      <span className="branch-picker-item-meta">
                        {copy.branchOccupiedInWorktree(
                          worktreeFolderName(entry.checkedOutWorktreePath),
                        )}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              ))
            : null}
        </div>

        {error ? (
          <div className="branch-picker-error" data-testid="branch-chip-error">
            {error}
          </div>
        ) : null}
      </DropdownMenu>
    </>
  );
}
