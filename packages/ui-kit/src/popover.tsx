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

export function PopoverContent(props: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  testId?: string;
}): ReactElement {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        className={props.className ? `ui-popover-content ${props.className}` : 'ui-popover-content'}
        sideOffset={6}
        align={props.align ?? 'start'}
        side={props.side ?? 'bottom'}
        {...(props.testId ? { 'data-testid': props.testId } : {})}
      >
        {props.children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
