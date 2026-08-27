import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactElement, ReactNode } from 'react';

export type PopoverProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  contentClassName?: string;
  testId?: string;
  /** Accessible name for the content, which Radix renders with role="dialog". */
  label?: string;
  /**
   * Whether to automatically focus the first focusable element when opened.
   * Defaults to false to avoid unwanted initial focus rings on close buttons.
   */
  autoFocus?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/** Anchored non-modal panel for context details and compact pickers. */
export function Popover(props: PopoverProps): ReactElement {
  const rootProps: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = {};
  if (props.open !== undefined) {
    rootProps.open = props.open;
  }
  if (props.onOpenChange !== undefined) {
    rootProps.onOpenChange = props.onOpenChange;
  }

  return (
    <PopoverPrimitive.Root {...rootProps}>
      <PopoverPrimitive.Trigger asChild>{props.trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className={
            props.contentClassName
              ? `ui-popover-content ${props.contentClassName}`
              : 'ui-popover-content'
          }
          sideOffset={6}
          align={props.align ?? 'start'}
          side={props.side ?? 'bottom'}
          {...(props.testId ? { 'data-testid': props.testId } : {})}
          {...(props.label ? { 'aria-label': props.label } : {})}
          onOpenAutoFocus={(event) => {
            props.onOpenAutoFocus?.(event);
            if (!props.onOpenAutoFocus && props.autoFocus !== true) {
              event.preventDefault();
            }
          }}
          onCloseAutoFocus={(event) => {
            props.onCloseAutoFocus?.(event);
          }}
        >
          {props.children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function PopoverTrigger(props: { children: ReactNode }): ReactElement {
  return <PopoverPrimitive.Trigger asChild>{props.children}</PopoverPrimitive.Trigger>;
}

export type PopoverContentProps = {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  testId?: string;
  label?: string;
  autoFocus?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

export function PopoverContent(props: PopoverContentProps): ReactElement {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        className={props.className ? `ui-popover-content ${props.className}` : 'ui-popover-content'}
        sideOffset={6}
        align={props.align ?? 'start'}
        side={props.side ?? 'bottom'}
        {...(props.testId ? { 'data-testid': props.testId } : {})}
        {...(props.label ? { 'aria-label': props.label } : {})}
        onOpenAutoFocus={(event) => {
          props.onOpenAutoFocus?.(event);
          if (!props.onOpenAutoFocus && props.autoFocus !== true) {
            event.preventDefault();
          }
        }}
        onCloseAutoFocus={(event) => {
          props.onCloseAutoFocus?.(event);
        }}
      >
        {props.children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
