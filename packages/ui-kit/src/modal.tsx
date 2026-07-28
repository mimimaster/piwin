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
}: ModalProps): ReactElement {
  const rootClass = className ? `piwin-modal ${className}` : 'piwin-modal';

  return (
    <MantineModal
      opened={open}
      onClose={() => onOpenChange(false)}
      title={title}
      size={size ?? 'md'}
      centered
      className={rootClass}
      classNames={{
        content: 'piwin-modal-content',
        header: 'piwin-modal-header',
        title: 'piwin-modal-title',
        body: 'piwin-modal-body',
        overlay: 'piwin-modal-overlay',
      }}
      data-testid={testId}
    >
      {children}
    </MantineModal>
  );
}
