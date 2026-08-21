/**
 * Message-bubble context menu that switches to a transcript selection target
 * when the user has a live range inside the bubble (not a nested CM host).
 */
import {
  Children,
  cloneElement,
  useRef,
  type MouseEvent,
  type ReactElement,
  type Ref,
} from 'react';
import {
  ContextMenuFromCatalog,
  type ContextMenuCapabilities,
  type ContextMenuDispatchers,
  type ContextMenuTarget,
} from './context-menu';
import {
  isTranscriptNestedHostTarget,
  resolveBubbleContextMenuTarget,
} from './transcript-selection-target';

type BubbleChildProps = {
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  ref?: Ref<HTMLElement | null>;
};

export type MessageBubbleContextMenuProps = {
  messageTarget: ContextMenuTarget;
  caps: ContextMenuCapabilities;
  dispatchers: ContextMenuDispatchers;
  children: ReactElement<BubbleChildProps>;
};

export function MessageBubbleContextMenu(props: MessageBubbleContextMenuProps): ReactElement {
  const resolvedRef = useRef<ContextMenuTarget | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const child = Children.only(props.children);

  const merged = cloneElement(child, {
    ref: rootRef,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      child.props.onContextMenu?.(event);
      if (isTranscriptNestedHostTarget(event.target)) {
        return;
      }
      resolvedRef.current = resolveBubbleContextMenuTarget(
        event.currentTarget,
        props.messageTarget,
      );
    },
  });

  return (
    <ContextMenuFromCatalog
      testId="message-context-menu"
      target={props.messageTarget}
      resolveTarget={() =>
        resolvedRef.current ??
        (rootRef.current
          ? resolveBubbleContextMenuTarget(rootRef.current, props.messageTarget)
          : props.messageTarget)
      }
      caps={props.caps}
      dispatchers={props.dispatchers}
    >
      {merged}
    </ContextMenuFromCatalog>
  );
}
