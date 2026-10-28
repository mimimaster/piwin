import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  lockSwipeAxis,
  swipeDragOffset,
  swipeSettlesOpen,
  type SwipeAxis,
} from './swipe-gesture.js';

export type SwipeActionTone = 'neutral' | 'accent' | 'danger';

export interface SwipeAction {
  key: string;
  label: string;
  tone: SwipeActionTone;
  onPress: () => void;
}

export type SwipeRowProps = {
  actions: readonly SwipeAction[];
  /** Controlled open state. Omit to let a surrounding `SwipeRowGroup` own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Identity inside a `SwipeRowGroup`; required there, ignored when controlled. */
  rowId?: string;
  className?: string;
  children: ReactNode;
};

const ACTION_WIDTH_PX = 72;

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  base: number;
  axis: SwipeAxis;
  offset: number;
  lastX: number;
  lastTime: number;
  velocity: number;
}

type SwipeGroupValue = {
  openId: string | undefined;
  setOpenId: (rowId: string | undefined) => void;
};

const SwipeGroupContext = createContext<SwipeGroupValue | null>(null);

/**
 * Rows inside one group behave like an iOS list: opening one closes the
 * others. Rows that pass `open` stay controlled by their parent instead.
 */
export function SwipeRowGroup(props: { children: ReactNode }): ReactElement {
  const [openId, setOpenId] = useState<string | undefined>();
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return <SwipeGroupContext.Provider value={value}>{props.children}</SwipeGroupContext.Provider>;
}

function useSwipeOpenState(props: SwipeRowProps): [boolean, (open: boolean) => void] {
  const group = useContext(SwipeGroupContext);
  const [localOpen, setLocalOpen] = useState(false);
  if (props.open !== undefined) {
    return [props.open, (open) => props.onOpenChange?.(open)];
  }
  if (group !== null && props.rowId !== undefined) {
    const rowId = props.rowId;
    return [
      group.openId === rowId,
      (open) => {
        if (open) group.setOpenId(rowId);
        else if (group.openId === rowId) group.setOpenId(undefined);
        props.onOpenChange?.(open);
      },
    ];
  }
  return [
    localOpen,
    (open) => {
      setLocalOpen(open);
      props.onOpenChange?.(open);
    },
  ];
}

/**
 * A list row that slides left to reveal actions, like Mail and Messages.
 * Vertical movement is left to native scrolling (`touch-action: pan-y`); only
 * a clearly horizontal drag is taken over.
 */
export function SwipeRow(props: SwipeRowProps): ReactElement {
  const { actions, className, children } = props;
  const [open, setOpen] = useSwipeOpenState(props);
  const revealWidth = actions.length * ACTION_WIDTH_PX;
  const [drag, setDrag] = useState<number | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  // The click that ends a drag must not also activate the row underneath.
  const swallowClickRef = useRef(false);
  const offset = drag ?? (open ? -revealWidth : 0);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const base = open ? -revealWidth : 0;
    swallowClickRef.current = false;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      base,
      axis: 'undecided',
      offset: base,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.startX;
    if (gesture.axis === 'undecided') {
      gesture.axis = lockSwipeAxis(dx, event.clientY - gesture.startY);
      if (gesture.axis === 'horizontal') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is best-effort in WebKit and test DOMs; the drag still follows.
        }
        setOpen(true);
      }
    }
    if (gesture.axis !== 'horizontal') return;
    gesture.velocity =
      (event.clientX - gesture.lastX) / Math.max(1, event.timeStamp - gesture.lastTime);
    gesture.lastX = event.clientX;
    gesture.lastTime = event.timeStamp;
    gesture.offset = swipeDragOffset(gesture.base, dx, revealWidth);
    setDrag(gesture.offset);
  };

  const endGesture = (cancelled: boolean): void => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture === null || gesture.axis !== 'horizontal') return;
    swallowClickRef.current = true;
    setDrag(null);
    setOpen(
      cancelled
        ? gesture.base !== 0
        : swipeSettlesOpen(gesture.offset, revealWidth, gesture.velocity),
    );
  };

  if (actions.length === 0) {
    return <>{children}</>;
  }

  return (
    <div
      className={['ui-swipe-row', className].filter(Boolean).join(' ')}
      data-open={open ? 'true' : 'false'}
      data-testid="swipe-row"
    >
      <div
        className="ui-swipe-actions"
        style={{ width: revealWidth }}
        aria-hidden={!open}
        data-revealed={offset < 0 ? 'true' : 'false'}
      >
        {actions.map((action) => (
          <button
            key={action.key}
            className={`ui-swipe-action ui-swipe-action--${action.tone}`}
            type="button"
            tabIndex={open ? 0 : -1}
            data-testid={`swipe-action-${action.key}`}
            onClick={() => {
              setOpen(false);
              action.onPress();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        className={
          drag !== null ? 'ui-swipe-content ui-swipe-content--dragging' : 'ui-swipe-content'
        }
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endGesture(false)}
        onPointerCancel={() => endGesture(true)}
        onClickCapture={(event) => {
          if (swallowClickRef.current) {
            swallowClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (open) {
            // Tapping an open row closes it, as in iOS lists.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
