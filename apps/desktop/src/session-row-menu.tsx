/**
 * Context menu for agent session rows (Cursor-style: pin/rename/archive/delete).
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { sessionActionItems } from './session-actions-menu';

export type SessionRowMenuAction =
  | 'pin'
  | 'unpin'
  | 'rename'
  | 'copy-id'
  | 'duplicate'
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
  /** Screen position for fixed menu (from contextmenu / button). */
  position: { x: number; y: number };
  onAction: (action: SessionRowMenuAction) => void;
  onClose: () => void;
};

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
  });

  return (
    <div
      ref={rootRef}
      className="session-row-menu"
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
          className={item.danger ? 'session-row-menu-item danger' : 'session-row-menu-item'}
          data-testid={item.testId}
          onClick={() => {
            props.onAction(item.action);
            props.onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
