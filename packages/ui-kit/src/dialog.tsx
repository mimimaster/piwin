import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactElement, ReactNode } from 'react';

export type DialogProps = {
  label: string;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId?: string;
  closeOnInteractOutside?: boolean;
};

/**
 * Radix owns focus, Escape handling, and modal semantics. Apps retain their
 * visual language through the existing modal CSS classes and theme tokens.
 */
export function Dialog({
  label,
  children,
  open,
  onOpenChange,
  testId,
  closeOnInteractOutside = false,
}: DialogProps): ReactElement {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-backdrop" />
        <DialogPrimitive.Content
          className="modal ui-dialog-content"
          aria-label={label}
          {...(testId ? { "data-testid": testId } : {})}
          onPointerDownOutside={(event) => {
            if (!closeOnInteractOutside) {
              event.preventDefault();
            }
          }}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
