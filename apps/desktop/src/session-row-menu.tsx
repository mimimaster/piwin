/**
 * Context menu for agent session rows (Cursor-style: pin/rename/archive/delete).
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import {
  IconArchive,
  IconArrowFork,
  IconGit,
  IconCopy,
  IconDownload,
  IconEdit,
  IconFolderOpen,
  IconPin,
  IconRefresh,
  IconTrash,
  IconUnarchive,
} from '@piwin/ui-kit';
import { sessionActionItems } from './session-actions-menu';

export type SessionRowMenuAction =
  | 'pin'
  | 'unpin'
  | 'rename'
  | 'copy-id'
  | 'duplicate'
  | 'fork-chat'
  | 'continue-in-project'
  | 'archive'
  | 'unarchive'
  | 'restore-pack'
  | 'delete'
  | 'export';

export type SessionRowMenuProps = {
  sessionId: string;
  isPinned: boolean;
  isArchived: boolean;
  storageState?: 'local' | 'offloaded' | 'missing-pack';
  canExport?: boolean;
  canDuplicate?: boolean;
  canForkChat?: boolean;
  canContinueInProject?: boolean;
  /** Screen position for fixed menu (from contextmenu / button). */
  position: { x: number; y: number };
  onAction: (action: SessionRowMenuAction) => void;
  onClose: () => void;
};

function renderSessionActionIcon(action: SessionRowMenuAction): ReactNode {
  switch (action) {
    case 'pin':
    case 'unpin':
      return <IconPin width={14} height={14} />;
    case 'rename':
      return <IconEdit width={14} height={14} />;
    case 'copy-id':
      return <IconCopy width={14} height={14} />;
    case 'duplicate':
      return <IconArrowFork width={14} height={14} />;
    case 'fork-chat':
      return <IconGit width={14} height={14} />;
    case 'continue-in-project':
      return <IconFolderOpen width={14} height={14} />;
    case 'export':
      return <IconDownload width={14} height={14} />;
    case 'archive':
      return <IconArchive width={14} height={14} />;
    case 'unarchive':
      return <IconUnarchive width={14} height={14} />;
    case 'restore-pack':
      return <IconRefresh width={14} height={14} />;
    case 'delete':
      return <IconTrash width={14} height={14} />;
    default:
      return null;
  }
}

export function SessionRowMenu(props: SessionRowMenuProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstItemRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        props.onClose();
        return;
      }
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const items = Array.from(
        root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
      );
      if (items.length === 0) {
        return;
      }
      const activeIndex = items.findIndex((item) => item === document.activeElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = items[(activeIndex + 1 + items.length) % items.length];
        next?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const previous = items[(activeIndex - 1 + items.length) % items.length];
        previous?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    };
    const onPointer = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-testid="session-row-menu"]')) {
        return;
      }
      props.onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [props]);

  const items = sessionActionItems({
    isPinned: props.isPinned,
    isArchived: props.isArchived,
    ...(props.storageState ? { storageState: props.storageState } : {}),
    ...(props.canExport === false ? { canExport: false } : {}),
    ...(props.canDuplicate === false ? { canDuplicate: false } : {}),
    ...(props.canForkChat === false ? { canForkChat: false } : {}),
    ...(props.canContinueInProject === false ? { canContinueInProject: false } : {}),
  });

  return (
    <div
      ref={rootRef}
      className="ui-menu-content session-row-menu"
      role="menu"
      data-testid="session-row-menu"
      data-session-id={props.sessionId}
      style={{ top: props.position.y, left: props.position.x }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={item.action}
          ref={index === 0 ? firstItemRef : undefined}
          type="button"
          role="menuitem"
          className={
            item.danger
              ? 'ui-menu-item session-row-menu-item danger'
              : 'ui-menu-item session-row-menu-item'
          }
          data-testid={item.testId}
          onClick={() => {
            props.onAction(item.action);
            props.onClose();
          }}
        >
          <span className="ui-menu-item-icon" aria-hidden="true">
            {renderSessionActionIcon(item.action)}
          </span>
          <span className="ui-menu-item-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
