import { useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { lockSwipeAxis, swipeDragOffset, swipeSettlesOpen, type SwipeAxis } from './swipe-gesture.js';

export interface SwipeAction {
  key: string;
  label: string;
  tone: 'neutral' | 'lamp' | 'danger';
  onPress: () => void;
}

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

/**
 * A list row that slides left to reveal actions, like Mail and Messages.
 * Vertical movement is left to native scrolling (`touch-action: pan-y`); only
 * a clearly horizontal drag is taken over. The parent owns which row is open
 * so that opening one closes the others.
 */
export function SwipeRow({
  actions,
  open,
  onOpenChange,
  children,
}: {
  actions: SwipeAction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}): ReactElement {
  const revealWidth = actions.length * ACTION_WIDTH_PX;
  const [drag, setDrag] = useState<number | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  // The click that ends a drag must not also open the row underneath.
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
        event.currentTarget.setPointerCapture(event.pointerId);
        onOpenChange(true);
      }
    }
    if (gesture.axis !== 'horizontal') return;
    gesture.velocity = (event.clientX - gesture.lastX) / Math.max(1, event.timeStamp - gesture.lastTime);
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
    onOpenChange(cancelled ? gesture.base !== 0 : swipeSettlesOpen(gesture.offset, revealWidth, gesture.velocity));
  };

  return (
    <div className="swipe-row">
      <div className="swipe-actions" style={{ width: revealWidth }} aria-hidden={!open}>
        {actions.map((action) => (
          <button
            key={action.key}
            className={`swipe-action ${action.tone}`}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onOpenChange(false);
              action.onPress();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        className={`swipe-content ${drag !== null ? 'dragging' : ''}`.trim()}
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
            onOpenChange(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
