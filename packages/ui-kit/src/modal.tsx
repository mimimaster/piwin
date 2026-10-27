import { Modal as MantineModal } from '@mantine/core';
import type { ModalProps as MantineModalProps } from '@mantine/core';
import type { ReactElement, ReactNode } from 'react';

export type ModalProps = {
  /** Whether the modal is currently open. */
  open: boolean;
  /** Called when the modal should close (overlay click, Esc, close button). */
  onOpenChange: (open: boolean) => void;
  /** Optional modal title rendered in the header. */
  title?: ReactNode;
  /** Modal body content. */
  children: ReactNode;
  /** Mantine size token or a CSS width. */
  size?: MantineModalProps['size'];
  /** Extra root className. */
  className?: string;
  /** Test id exposed on the root element. */
  testId?: string;
  /** Allow closing by clicking the overlay. */
  closeOnClickOutside?: boolean | undefined;
  /** Allow closing by pressing Escape. */
  closeOnEscape?: boolean | undefined;
  /** Cover the whole viewport (editors that bring their own chrome). */
  fullScreen?: boolean | undefined;
  /** Header close button; with no title as well, the header is not rendered. */
  withCloseButton?: boolean | undefined;
};

/** Piwin-branded Mantine Modal for in-settings editing dialogs.
 * API mirrors the existing Radix-backed `Dialog` for easier migration. */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  size,
  className,
  testId,
  closeOnClickOutside,
  closeOnEscape,
  fullScreen,
  withCloseButton,
}: ModalProps): ReactElement {
  const rootClass = className ? `piwin-modal ${className}` : 'piwin-modal';
  const contentClass = className ? `piwin-modal-content ${className}` : 'piwin-modal-content';
  const clickOutsideProp = closeOnClickOutside !== undefined ? { closeOnClickOutside } : undefined;
  const escapeProp = closeOnEscape !== undefined ? { closeOnEscape } : undefined;
  const fullScreenProp = fullScreen !== undefined ? { fullScreen } : undefined;
  const closeButtonProp = withCloseButton !== undefined ? { withCloseButton } : undefined;

  return (
    <MantineModal
      opened={open}
      onClose={() => onOpenChange(false)}
      title={title}
      size={size ?? 'md'}
      centered
      {...clickOutsideProp}
      {...escapeProp}
      {...fullScreenProp}
      {...closeButtonProp}
      className={rootClass}
      classNames={{
        root: rootClass,
        content: contentClass,
        header: 'piwin-modal-header',
        title: 'piwin-modal-title',
        body: 'piwin-modal-body',
        overlay: 'piwin-modal-overlay',
      }}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      {/*
        Portaled to document.body, but React still bubbles synthetic events through
        the React tree. Nested under custom overlays (provider editor, settings shell)
        a click inside the modal must not reach parent onClick={close} handlers.
      */}
      <div
        className="piwin-modal-event-boundary"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </MantineModal>
  );
}
