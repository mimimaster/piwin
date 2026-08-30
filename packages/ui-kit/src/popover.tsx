import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';

export type VirtualAnchorRect = {
  getBoundingClientRect: () => DOMRect;
};

export type PopoverProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Clickable trigger. Optional when `virtualAnchor` positions the content. */
  trigger?: ReactNode;
  /** Positions content against a live rect (Range, virtual element). */
  virtualAnchor?: VirtualAnchorRect;
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

function applyVirtualAnchorRect(element: HTMLElement, rect: DOMRect): void {
  element.style.position = 'fixed';
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${Math.max(1, rect.width)}px`;
  element.style.height = `${Math.max(1, rect.height)}px`;
  element.style.pointerEvents = 'none';
  element.style.margin = '0';
  element.style.padding = '0';
  element.style.border = '0';
}

/** Hidden fixed box whose rect Radix uses as the Popper anchor. */
export function PopoverVirtualAnchor(props: VirtualAnchorRect): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    applyVirtualAnchorRect(element, props.getBoundingClientRect());
  });
  return (
    <PopoverPrimitive.Anchor asChild>
      <div
        ref={ref}
        className="ui-popover-virtual-anchor"
        data-testid="ui-popover-virtual-anchor"
        aria-hidden="true"
      />
    </PopoverPrimitive.Anchor>
  );
}

export function PopoverAnchor(props: { children: ReactNode }): ReactElement {
  return <PopoverPrimitive.Anchor asChild>{props.children}</PopoverPrimitive.Anchor>;
}

/** Range → virtual element so Popover collision stays inside Radix. */
export function virtualAnchorFromRange(range: Range): VirtualAnchorRect {
  return {
    getBoundingClientRect: () => {
      try {
        return range.getBoundingClientRect();
      } catch {
        return new DOMRect();
      }
    },
  };
}

function popoverContentProps(props: {
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  testId?: string;
  label?: string;
  autoFocus?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): {
  className: string;
  sideOffset: number;
  collisionPadding: number;
  avoidCollisions: true;
  align: 'start' | 'center' | 'end';
  side: 'top' | 'right' | 'bottom' | 'left';
  'data-testid'?: string;
  'aria-label'?: string;
  onOpenAutoFocus: (event: Event) => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  const contentProps: {
    className: string;
    sideOffset: number;
    collisionPadding: number;
    avoidCollisions: true;
    align: 'start' | 'center' | 'end';
    side: 'top' | 'right' | 'bottom' | 'left';
    'data-testid'?: string;
    'aria-label'?: string;
    onOpenAutoFocus: (event: Event) => void;
    onCloseAutoFocus: (event: Event) => void;
  } = {
    className: props.contentClassName
      ? `ui-popover-content ${props.contentClassName}`
      : 'ui-popover-content',
    sideOffset: 6,
    collisionPadding: 8,
    avoidCollisions: true,
    align: props.align ?? 'start',
    side: props.side ?? 'bottom',
    onOpenAutoFocus: (event) => {
      props.onOpenAutoFocus?.(event);
      if (!props.onOpenAutoFocus && props.autoFocus !== true) {
        event.preventDefault();
      }
    },
    onCloseAutoFocus: (event) => {
      props.onCloseAutoFocus?.(event);
    },
  };
  if (props.testId) contentProps['data-testid'] = props.testId;
  if (props.label) contentProps['aria-label'] = props.label;
  return contentProps;
}

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

  const contentProps = popoverContentProps(props);

  return (
    <PopoverPrimitive.Root modal={false} {...rootProps}>
      {props.virtualAnchor ? (
        <PopoverVirtualAnchor getBoundingClientRect={props.virtualAnchor.getBoundingClientRect} />
      ) : null}
      {props.trigger ? (
        <PopoverPrimitive.Trigger asChild>{props.trigger}</PopoverPrimitive.Trigger>
      ) : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content {...contentProps}>{props.children}</PopoverPrimitive.Content>
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
  const contentProps = popoverContentProps({
    ...(props.className !== undefined ? { contentClassName: props.className } : {}),
    ...(props.align !== undefined ? { align: props.align } : {}),
    ...(props.side !== undefined ? { side: props.side } : {}),
    ...(props.testId !== undefined ? { testId: props.testId } : {}),
    ...(props.label !== undefined ? { label: props.label } : {}),
    ...(props.autoFocus !== undefined ? { autoFocus: props.autoFocus } : {}),
    ...(props.onOpenAutoFocus !== undefined ? { onOpenAutoFocus: props.onOpenAutoFocus } : {}),
    ...(props.onCloseAutoFocus !== undefined ? { onCloseAutoFocus: props.onCloseAutoFocus } : {}),
  });
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content {...contentProps}>{props.children}</PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
