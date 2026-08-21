import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { useRef, type ReactElement, type ReactNode } from 'react';
import { IconChevronRight } from './icons/shell-icons.js';
import { restoreSelectionRanges, snapshotSelectionRanges } from './selection-ranges.js';

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
  onSelect?: (() => void) | undefined;
  disabled?: boolean | undefined;
  danger?: boolean | undefined;
  testId?: string | undefined;
  icon?: ReactNode | undefined;
  shortcut?: string | undefined;
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
      {props.icon ? (
        <span className="ui-menu-item-icon" aria-hidden="true">
          {props.icon}
        </span>
      ) : null}
      <span className="ui-menu-item-label">{props.children}</span>
      {props.shortcut ? <span className="ui-menu-item-shortcut">{props.shortcut}</span> : null}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuSeparator(): ReactElement {
  return <DropdownMenuPrimitive.Separator className="ui-menu-separator" />;
}

export type DropdownMenuLabelProps = {
  children: ReactNode;
  className?: string | undefined;
  icon?: ReactNode | undefined;
};

/** Non-interactive caption row; skipped by Radix roving focus. */
export function DropdownMenuLabel(props: DropdownMenuLabelProps): ReactElement {
  return (
    <DropdownMenuPrimitive.Label
      className={props.className ? `ui-menu-label ${props.className}` : 'ui-menu-label'}
    >
      {props.icon ? (
        <span className="ui-menu-label-icon" aria-hidden="true">
          {props.icon}
        </span>
      ) : null}
      <span className="ui-menu-label-text">{props.children}</span>
    </DropdownMenuPrimitive.Label>
  );
}

export type DropdownMenuSubProps = {
  children: ReactNode;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
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
  disabled?: boolean | undefined;
  testId?: string | undefined;
  icon?: ReactNode | undefined;
};

export function DropdownMenuSubTrigger(props: DropdownMenuSubTriggerProps): ReactElement {
  const triggerProps: {
    className: string;
    disabled?: boolean;
    'data-testid'?: string;
  } = { className: 'ui-menu-item ui-menu-sub-trigger' };
  if (props.disabled !== undefined) triggerProps.disabled = props.disabled;
  if (props.testId !== undefined) triggerProps['data-testid'] = props.testId;

  return (
    <DropdownMenuPrimitive.SubTrigger {...triggerProps}>
      {props.icon ? (
        <span className="ui-menu-item-icon" aria-hidden="true">
          {props.icon}
        </span>
      ) : null}
      <span className="ui-menu-item-label">{props.children}</span>
      <span className="ui-menu-item-chevron" aria-hidden="true">
        <IconChevronRight width={12} height={12} />
      </span>
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export type DropdownMenuSubContentProps = {
  children: ReactNode;
  className?: string | undefined;
  testId?: string | undefined;
  label?: string | undefined;
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
  content: ReactNode;
  children: ReactNode;
  contentClassName?: string | undefined;
  testId?: string | undefined;
  label?: string | undefined;
  modal?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onOpenAutoFocus?: ((event: Event) => void) | undefined;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
};

/**
 * Right-click / long-press context menu with full keyboard semantics.
 * Defaults to modal={false} and blocks auto-focus so the page stays usable.
 * Radix still clears the live selection on open — snapshot on contextmenu
 * and put the ranges back so the highlight does not vanish.
 */
export function ContextMenu(props: ContextMenuProps): ReactElement {
  const savedRangesRef = useRef<Range[]>([]);
  return (
    <ContextMenuPrimitive.Root
      modal={props.modal ?? false}
      onOpenChange={(open) => {
        if (open) {
          restoreSelectionRanges(savedRangesRef.current);
          requestAnimationFrame(() => restoreSelectionRanges(savedRangesRef.current));
        }
        props.onOpenChange?.(open);
      }}
    >
      <ContextMenuPrimitive.Trigger
        asChild
        onContextMenu={() => {
          savedRangesRef.current = snapshotSelectionRanges();
        }}
      >
        {props.children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={
            props.contentClassName
              ? `ui-menu-content ${props.contentClassName}`
              : 'ui-menu-content'
          }
          {...({
            onOpenAutoFocus: (event: Event) => {
              props.onOpenAutoFocus?.(event);
              if (!props.onOpenAutoFocus) {
                event.preventDefault();
              }
            },
          } as Record<string, unknown>)}
          onCloseAutoFocus={(event) => {
            props.onCloseAutoFocus?.(event);
            if (!props.onCloseAutoFocus) {
              event.preventDefault();
            }
          }}
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
  onSelect?: (() => void) | undefined;
  disabled?: boolean | undefined;
  danger?: boolean | undefined;
  testId?: string | undefined;
  icon?: ReactNode | undefined;
  shortcut?: string | undefined;
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
      {props.icon ? (
        <span className="ui-menu-item-icon" aria-hidden="true">
          {props.icon}
        </span>
      ) : null}
      <span className="ui-menu-item-label">{props.children}</span>
      {props.shortcut ? <span className="ui-menu-item-shortcut">{props.shortcut}</span> : null}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuSeparator(): ReactElement {
  return <ContextMenuPrimitive.Separator className="ui-menu-separator" />;
}

export type ContextMenuLabelProps = {
  children: ReactNode;
  className?: string | undefined;
  icon?: ReactNode | undefined;
};

/** Non-interactive caption row in context menu. */
export function ContextMenuLabel(props: ContextMenuLabelProps): ReactElement {
  return (
    <ContextMenuPrimitive.Label
      className={props.className ? `ui-menu-label ${props.className}` : 'ui-menu-label'}
    >
      {props.icon ? (
        <span className="ui-menu-label-icon" aria-hidden="true">
          {props.icon}
        </span>
      ) : null}
      <span className="ui-menu-label-text">{props.children}</span>
    </ContextMenuPrimitive.Label>
  );
}

export type ContextMenuSubProps = {
  children: ReactNode;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
};

/** Nested context-menu branch (CM-16 More…). Radix owns hover intent and Escape. */
export function ContextMenuSub(props: ContextMenuSubProps): ReactElement {
  const subProps: { open?: boolean; onOpenChange?: (open: boolean) => void } = {};
  if (props.open !== undefined) subProps.open = props.open;
  if (props.onOpenChange !== undefined) subProps.onOpenChange = props.onOpenChange;

  return <ContextMenuPrimitive.Sub {...subProps}>{props.children}</ContextMenuPrimitive.Sub>;
}

export type ContextMenuSubTriggerProps = {
  children: ReactNode;
  disabled?: boolean | undefined;
  testId?: string | undefined;
  icon?: ReactNode | undefined;
};

export function ContextMenuSubTrigger(props: ContextMenuSubTriggerProps): ReactElement {
  const triggerProps: {
    className: string;
    disabled?: boolean;
    'data-testid'?: string;
  } = { className: 'ui-menu-item ui-menu-sub-trigger' };
  if (props.disabled !== undefined) triggerProps.disabled = props.disabled;
  if (props.testId !== undefined) triggerProps['data-testid'] = props.testId;

  return (
    <ContextMenuPrimitive.SubTrigger {...triggerProps}>
      {props.icon ? (
        <span className="ui-menu-item-icon" aria-hidden="true">
          {props.icon}
        </span>
      ) : null}
      <span className="ui-menu-item-label">{props.children}</span>
      <span className="ui-menu-item-chevron" aria-hidden="true">
        <IconChevronRight width={12} height={12} />
      </span>
    </ContextMenuPrimitive.SubTrigger>
  );
}

export type ContextMenuSubContentProps = {
  children: ReactNode;
  className?: string | undefined;
  testId?: string | undefined;
  label?: string | undefined;
};

export function ContextMenuSubContent(props: ContextMenuSubContentProps): ReactElement {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        className={props.className ? `ui-menu-content ${props.className}` : 'ui-menu-content'}
        sideOffset={4}
        {...(props.testId ? { 'data-testid': props.testId } : {})}
        {...(props.label ? { 'aria-label': props.label } : {})}
      >
        {props.children}
      </ContextMenuPrimitive.SubContent>
    </ContextMenuPrimitive.Portal>
  );
}
