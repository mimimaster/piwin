import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ReactElement, ReactNode } from 'react';

export type DropdownMenuProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  contentClassName?: string;
  testId?: string;
  label?: string;
  /**
   * Modal menus trap focus and mark the rest of the page inert. Set false for
   * menus anchored inside a still-usable surface (e.g. the composer dock).
   */
  modal?: boolean;
};

/**
 * Anchored action menu. Radix owns focus, Escape, outside interaction,
 * arrow navigation, and collision-aware positioning.
 */
export function DropdownMenu(props: DropdownMenuProps): ReactElement {
  const rootProps: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    modal?: boolean;
  } = {};
  if (props.open !== undefined) rootProps.open = props.open;
  if (props.onOpenChange !== undefined) rootProps.onOpenChange = props.onOpenChange;
  if (props.modal !== undefined) rootProps.modal = props.modal;

  return (
    <DropdownMenuPrimitive.Root {...rootProps}>
      <DropdownMenuPrimitive.Trigger asChild>{props.trigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className={
            props.contentClassName
              ? `ui-menu-content ${props.contentClassName}`
              : 'ui-menu-content'
          }
          sideOffset={6}
          align={props.align ?? 'start'}
          side={props.side ?? 'bottom'}
          {...(props.testId ? { 'data-testid': props.testId } : {})}
          {...(props.label ? { 'aria-label': props.label } : {})}
        >
          {props.children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

export type DropdownMenuItemProps = {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
};

export function DropdownMenuItem(props: DropdownMenuItemProps): ReactElement {
  const itemProps: {
    className: string;
    disabled?: boolean;
    'data-testid'?: string;
    onSelect: (event: Event) => void;
  } = {
    className: props.danger ? 'ui-menu-item danger' : 'ui-menu-item',
    onSelect: (event: Event) => {
      if (props.disabled) {
        event.preventDefault();
        return;
      }
      props.onSelect?.();
    },
  };
  if (props.disabled !== undefined) itemProps.disabled = props.disabled;
  if (props.testId !== undefined) itemProps['data-testid'] = props.testId;

  return (
    <DropdownMenuPrimitive.Item {...itemProps}>
      {props.children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuSeparator(): ReactElement {
  return <DropdownMenuPrimitive.Separator className="ui-menu-separator" />;
}

export type DropdownMenuLabelProps = {
  children: ReactNode;
  className?: string;
};

/** Non-interactive caption row; skipped by Radix roving focus. */
export function DropdownMenuLabel(props: DropdownMenuLabelProps): ReactElement {
  return (
    <DropdownMenuPrimitive.Label
      className={props.className ? `ui-menu-label ${props.className}` : 'ui-menu-label'}
    >
      {props.children}
    </DropdownMenuPrimitive.Label>
  );
}

export type DropdownMenuSubProps = {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Nested menu branch. Radix owns hover intent, arrow traversal, and Escape. */
export function DropdownMenuSub(props: DropdownMenuSubProps): ReactElement {
  const subProps: { open?: boolean; onOpenChange?: (open: boolean) => void } = {};
  if (props.open !== undefined) subProps.open = props.open;
  if (props.onOpenChange !== undefined) subProps.onOpenChange = props.onOpenChange;

  return <DropdownMenuPrimitive.Sub {...subProps}>{props.children}</DropdownMenuPrimitive.Sub>;
}

export type DropdownMenuSubTriggerProps = {
  children: ReactNode;
  disabled?: boolean;
  testId?: string;
};

export function DropdownMenuSubTrigger(props: DropdownMenuSubTriggerProps): ReactElement {
  const triggerProps: {
    className: string;
    disabled?: boolean;
    'data-testid'?: string;
  } = { className: 'ui-menu-item' };
  if (props.disabled !== undefined) triggerProps.disabled = props.disabled;
  if (props.testId !== undefined) triggerProps['data-testid'] = props.testId;

  return (
    <DropdownMenuPrimitive.SubTrigger {...triggerProps}>
      {props.children}
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export type DropdownMenuSubContentProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
  label?: string;
};

export function DropdownMenuSubContent(props: DropdownMenuSubContentProps): ReactElement {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        className={props.className ? `ui-menu-content ${props.className}` : 'ui-menu-content'}
        sideOffset={4}
        {...(props.testId ? { 'data-testid': props.testId } : {})}
        {...(props.label ? { 'aria-label': props.label } : {})}
      >
        {props.children}
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
  );
}

export type ContextMenuProps = {
  children: ReactNode;
  content: ReactNode;
  contentClassName?: string;
  testId?: string;
  label?: string;
};

/**
 * Right-click / long-press context menu with full keyboard semantics.
 */
export function ContextMenu(props: ContextMenuProps): ReactElement {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{props.children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={
            props.contentClassName
              ? `ui-menu-content ${props.contentClassName}`
              : 'ui-menu-content'
          }
          {...(props.testId ? { 'data-testid': props.testId } : {})}
          {...(props.label ? { 'aria-label': props.label } : {})}
        >
          {props.content}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

export type ContextMenuItemProps = {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
};

export function ContextMenuItem(props: ContextMenuItemProps): ReactElement {
  const itemProps: {
    className: string;
    disabled?: boolean;
    'data-testid'?: string;
    onSelect: (event: Event) => void;
  } = {
    className: props.danger ? 'ui-menu-item danger' : 'ui-menu-item',
    onSelect: (event: Event) => {
      if (props.disabled) {
        event.preventDefault();
        return;
      }
      props.onSelect?.();
    },
  };
  if (props.disabled !== undefined) itemProps.disabled = props.disabled;
  if (props.testId !== undefined) itemProps['data-testid'] = props.testId;

  return (
    <ContextMenuPrimitive.Item {...itemProps}>
      {props.children}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuSeparator(): ReactElement {
  return <ContextMenuPrimitive.Separator className="ui-menu-separator" />;
}
