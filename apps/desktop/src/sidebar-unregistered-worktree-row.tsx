import type { ReactElement } from 'react';
import { ContextMenu, ContextMenuItem } from '@piwin/ui-kit';
import { projectDisplayName } from './project-display-name';
import { IconFolder, IconTrash } from './shell-icons';

export function SidebarUnregisteredWorktreeRow(props: {
  path: string;
  branch: string | null;
  locale: 'en' | 'zh-CN' | undefined;
  onOpen?: ((path: string) => void) | undefined;
  onRemove?: ((path: string) => void) | undefined;
  removeLabel: string;
  menuLabel: string;
}): ReactElement {
  const displayName = projectDisplayName(props.path);
  const label = props.locale === 'en' ? `Open worktree ${displayName}` : `打开工作树 ${displayName}`;
  return (
    <ContextMenu
      modal
      label={props.menuLabel}
      testId="project-context-menu"
      content={
        <ContextMenuItem
          testId="project-remove-from-sidebar"
          onSelect={() => props.onRemove?.(props.path)}
          disabled={props.onRemove === undefined}
        >
          <IconTrash width={14} height={14} />
          {props.removeLabel}
        </ContextMenuItem>
      }
    >
    <div className="tree-folder-summary">
      <button
        type="button"
        className="tree-folder-toggle"
        aria-label={label}
        title={label}
        onClick={() => props.onOpen?.(props.path)}
      >
        <IconFolder className="tree-folder-icon" />
      </button>
      <button
        type="button"
        className="tree-folder-main"
        data-testid="unregistered-worktree-item"
        title={`${label} · ${props.path}`}
        onClick={() => props.onOpen?.(props.path)}
      >
        <span className="tree-folder-title">
          <span className="tree-folder-name">{displayName}</span>
          <span className="tree-folder-branch">{props.branch ?? 'HEAD'}</span>
        </span>
      </button>
    </div>
    </ContextMenu>
  );
}
