import {
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import {
  CONVERSATION_PANE_MAX_RATIO,
  CONVERSATION_PANE_MIN_RATIO,
  clampConversationPaneRatio,
  type ConversationPaneNode,
  type ConversationPaneOrientation,
  type ConversationPaneRect,
} from './conversation-pane-layout.js';

export type ConversationPaneSplitRect = Omit<ConversationPaneRect, 'paneId'> & {
  splitId: string;
  orientation: ConversationPaneOrientation;
  ratio: number;
};

export function listConversationPaneSplitRects(
  node: ConversationPaneNode,
  rect: Omit<ConversationPaneRect, 'paneId'> = { left: 0, top: 0, width: 1, height: 1 },
): ConversationPaneSplitRect[] {
  if (node.kind === 'leaf') return [];
  const current: ConversationPaneSplitRect = {
    splitId: node.splitId,
    orientation: node.orientation,
    ratio: node.ratio,
    ...rect,
  };
  if (node.orientation === 'row') {
    const firstWidth = rect.width * node.ratio;
    return [
      current,
      ...listConversationPaneSplitRects(node.first, { ...rect, width: firstWidth }),
      ...listConversationPaneSplitRects(node.second, {
        ...rect,
        left: rect.left + firstWidth,
        width: rect.width - firstWidth,
      }),
    ];
  }
  const firstHeight = rect.height * node.ratio;
  return [
    current,
    ...listConversationPaneSplitRects(node.first, { ...rect, height: firstHeight }),
    ...listConversationPaneSplitRects(node.second, {
      ...rect,
      top: rect.top + firstHeight,
      height: rect.height - firstHeight,
    }),
  ];
}

export type ConversationPaneSeparatorProps = {
  split: ConversationPaneSplitRect;
  rootRef: RefObject<HTMLDivElement | null>;
  locale: 'zh-CN' | 'en';
  onRatioChange: (splitId: string, ratio: number) => void;
};

function separatorStyle(split: ConversationPaneSplitRect): CSSProperties {
  if (split.orientation === 'row') {
    return {
      left: `${(split.left + split.width * split.ratio) * 100}%`,
      top: `${split.top * 100}%`,
      height: `${split.height * 100}%`,
    };
  }
  return {
    left: `${split.left * 100}%`,
    top: `${(split.top + split.height * split.ratio) * 100}%`,
    width: `${split.width * 100}%`,
  };
}

export function ConversationPaneSeparator(props: ConversationPaneSeparatorProps): ReactElement {
  const pointerIdRef = useRef<number | null>(null);
  const vertical = props.split.orientation === 'row';

  function ratioFromPointer(event: PointerEvent<HTMLDivElement>): number | null {
    const rootRect = props.rootRef.current?.getBoundingClientRect();
    if (!rootRect || rootRect.width <= 0 || rootRect.height <= 0) return null;
    const normalizedX = (event.clientX - rootRect.left) / rootRect.width;
    const normalizedY = (event.clientY - rootRect.top) / rootRect.height;
    return vertical
      ? clampConversationPaneRatio((normalizedX - props.split.left) / props.split.width)
      : clampConversationPaneRatio((normalizedY - props.split.top) / props.split.height);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = 'true';
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (pointerIdRef.current !== event.pointerId) return;
    const ratio = ratioFromPointer(event);
    if (ratio !== null) props.onRatioChange(props.split.splitId, ratio);
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>): void {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    event.currentTarget.dataset.dragging = 'false';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    let nextRatio: number | null = null;
    if (event.key === 'Home') nextRatio = CONVERSATION_PANE_MIN_RATIO;
    if (event.key === 'End') nextRatio = CONVERSATION_PANE_MAX_RATIO;
    if (vertical && event.key === 'ArrowLeft') nextRatio = props.split.ratio - 0.05;
    if (vertical && event.key === 'ArrowRight') nextRatio = props.split.ratio + 0.05;
    if (!vertical && event.key === 'ArrowUp') nextRatio = props.split.ratio - 0.05;
    if (!vertical && event.key === 'ArrowDown') nextRatio = props.split.ratio + 0.05;
    if (nextRatio === null) return;
    event.preventDefault();
    props.onRatioChange(props.split.splitId, nextRatio);
  }

  const percentage = Math.round(props.split.ratio * 100);
  return (
    <div
      className={`conversation-pane-separator is-${vertical ? 'vertical' : 'horizontal'}`}
      style={separatorStyle(props.split)}
      role="separator"
      tabIndex={0}
      aria-label={
        props.locale === 'zh-CN'
          ? vertical
            ? '调整左右 Chat 窗格大小'
            : '调整上下 Chat 窗格大小'
          : vertical
            ? 'Resize left and right Chat panes'
            : 'Resize upper and lower Chat panes'
      }
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuemin={CONVERSATION_PANE_MIN_RATIO * 100}
      aria-valuemax={CONVERSATION_PANE_MAX_RATIO * 100}
      aria-valuenow={percentage}
      data-testid={`conversation-pane-separator-${props.split.splitId}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyDown={handleKeyDown}
    >
      <span aria-hidden="true" />
    </div>
  );
}
