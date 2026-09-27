import type { ReactElement } from 'react';
import { projectDisplayName } from './project-display-name';
import { IconFolder } from './shell-icons';

export function SidebarUnregisteredWorktreeRow(props: {
  path: string;
  branch: string | null;
  locale: 'en' | 'zh-CN' | undefined;
  onOpen?: ((path: string) => void) | undefined;
}): ReactElement {
  const displayName = projectDisplayName(props.path);
  const label = props.locale === 'en' ? `Open worktree ${displayName}` : `打开工作树 ${displayName}`;
  return (
    <div className="tree-folder-summary is-grouped">
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
          <span>{displayName}</span>
          <span className="tree-folder-branch">{props.branch ?? 'HEAD'}</span>
        </span>
      </button>
    </div>
  );
}
