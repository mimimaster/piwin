import { createPortal } from 'react-dom';
import type { MouseEvent, ReactElement, ReactNode } from 'react';

/**
 * Layers must leave the transcript scroller. iOS treats `position: fixed`
 * inside `overflow: auto` as `absolute` relative to that scroller, so a
 * sheet mounted in a message cannot cover the shell or own gestures.
 */
export function MobilePortal({ children }: { children: ReactNode }): ReactElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  return createPortal(children, document.body);
}

export type MobileLayerProps = {
  isOpen: boolean;
  onClose: () => void;
  overlayClassName?: string | undefined;
  children: ReactNode;
};

export function MobileLayer({
  isOpen,
  onClose,
  overlayClassName = 'mobile-drawer-overlay',
  children,
}: MobileLayerProps): ReactElement | null {
  if (!isOpen) {
    return null;
  }

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <MobilePortal>
      <div
        className={overlayClassName}
        onClick={handleOverlayClick}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </MobilePortal>
  );
}
