// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  sessionDockThresholdPx,
  useSessionStageDock,
  type SessionStageDock,
  type UseSessionStageDockInput,
} from './use-session-stage-dock';
import type { ConversationWidth } from '../platform/ui-preferences';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type ResizeCallback = (entries: unknown[], observer: unknown) => void;

const resizeCallbacks = new Set<ResizeCallback>();

class TestResizeObserver {
  private readonly callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeCallbacks.add(callback as ResizeCallback);
  }

  public disconnect(): void {
    resizeCallbacks.delete(this.callback as ResizeCallback);
  }

  public observe(_target?: Element): void {}

  public unobserve(): void {}
}

/** Drive every live observer with a border-box width. */
function emitStageWidth(inlineSize: number): void {
  act(() => {
    for (const callback of resizeCallbacks) {
      callback(
        [
          {
            target: null,
            borderBoxSize: [{ inlineSize, blockSize: 600 }],
            contentRect: { width: inlineSize },
          },
        ],
        null,
      );
    }
  });
}

const stageEl = document.createElement('div');
let latest: SessionStageDock | null = null;

function Probe(props: Omit<UseSessionStageDockInput, 'stageRef'>): ReactElement {
  const stageRef = useRef<HTMLDivElement | null>(stageEl);
  latest = useSessionStageDock({ ...props, stageRef });
  return <div />;
}

describe('sessionDockThresholdPx', () => {
  it('resolves thresholds so the right half of a centered stage fits the dock', () => {
    expect(sessionDockThresholdPx('narrow')).toBe(640 + 2 * 300);
    expect(sessionDockThresholdPx('default')).toBe(720 + 2 * 300);
    expect(sessionDockThresholdPx('wide')).toBe(840 + 2 * 300);
  });
});

describe('useSessionStageDock', () => {
  let container: HTMLElement;
  let root: Root;
  let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

  function renderDock(input: {
    conversationWidth?: ConversationWidth;
    hasAnyContent?: boolean;
    suppressed?: boolean;
  }): void {
    act(() =>
      root.render(
        <Probe
          conversationWidth={input.conversationWidth ?? 'default'}
          hasAnyContent={input.hasAnyContent ?? true}
          suppressed={input.suppressed ?? false}
        />,
      ),
    );
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resizeCallbacks.clear();
    latest = null;
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resizeCallbacks.clear();
    globalThis.ResizeObserver = originalResizeObserver as typeof ResizeObserver;
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('docks only once the border-box width clears the default threshold', () => {
    renderDock({});
    expect(latest?.canAutoDock).toBe(false);
    expect(latest?.isDocked).toBe(false);

    emitStageWidth(1319);
    expect(latest?.canAutoDock).toBe(false);
    expect(latest?.isDocked).toBe(false);

    emitStageWidth(1320);
    expect(latest?.canAutoDock).toBe(true);
    expect(latest?.isDocked).toBe(true);
  });

  it('honours the narrow and wide measures', () => {
    renderDock({ conversationWidth: 'narrow' });
    emitStageWidth(1240);
    expect(latest?.isDocked).toBe(true);

    act(() => root.render(<Probe conversationWidth="wide" hasAnyContent suppressed={false} />));
    emitStageWidth(1439);
    expect(latest?.isDocked).toBe(false);
    emitStageWidth(1440);
    expect(latest?.isDocked).toBe(true);
  });

  it('stays closed without content or while suppressed', () => {
    renderDock({ hasAnyContent: false });
    emitStageWidth(1500);
    expect(latest?.canAutoDock).toBe(true);
    expect(latest?.isDocked).toBe(false);

    act(() => root.render(<Probe conversationWidth="default" hasAnyContent suppressed />));
    emitStageWidth(1500);
    expect(latest?.canAutoDock).toBe(false);
    expect(latest?.isDocked).toBe(false);
  });

  it('dismisses, keeps dismissal across suppressed toggles, and forgives on re-widening', () => {
    renderDock({});
    emitStageWidth(1500);
    expect(latest?.isDocked).toBe(true);

    act(() => latest?.dismiss());
    expect(latest?.userDismissed).toBe(true);
    expect(latest?.isDocked).toBe(false);
    expect(latest?.canAutoDock).toBe(true);

    // Opening and closing an overlay (`suppressed`) must not revive a dismissed sheet.
    renderDock({ suppressed: true });
    expect(latest?.canAutoDock).toBe(false);
    expect(latest?.isDocked).toBe(false);
    renderDock({ suppressed: false });
    expect(latest?.userDismissed).toBe(true);
    expect(latest?.isDocked).toBe(false);

    act(() => latest?.toggle());
    expect(latest?.isDocked).toBe(true);

    act(() => latest?.dismiss());
    expect(latest?.isDocked).toBe(false);

    // Narrow below the threshold, then widen again: dismissal resets.
    emitStageWidth(800);
    expect(latest?.canAutoDock).toBe(false);
    emitStageWidth(1500);
    expect(latest?.canAutoDock).toBe(true);
    expect(latest?.userDismissed).toBe(false);
    expect(latest?.isDocked).toBe(true);
  });

  it('re-attaches ResizeObserver when stageRef mounts on a new element', () => {
    const observed: Element[] = [];
    class TrackingRO extends TestResizeObserver {
      public override observe(target?: Element): void {
        if (target) observed.push(target);
        super.observe(target);
      }
    }
    globalThis.ResizeObserver = TrackingRO as unknown as typeof ResizeObserver;

    function CallbackProbe(props: { stageKey: string }): ReactElement {
      const dock = useSessionStageDock({
        conversationWidth: 'default',
        hasAnyContent: true,
        suppressed: false,
      });
      latest = dock;
      return <div key={props.stageKey} ref={dock.stageRef} data-testid={props.stageKey} />;
    }

    act(() => root.render(<CallbackProbe stageKey="stage-a" />));
    const firstNode = container.querySelector('[data-testid="stage-a"]');
    expect(firstNode).not.toBeNull();
    emitStageWidth(1500);
    expect(latest?.isDocked).toBe(true);

    act(() => latest?.dismiss());
    expect(latest?.userDismissed).toBe(true);

    // Portal remount replaces the DOM element; observer moves and dismissal stays.
    act(() => root.render(<CallbackProbe stageKey="stage-b" />));
    const secondNode = container.querySelector('[data-testid="stage-b"]');
    expect(secondNode).not.toBeNull();
    expect(secondNode).not.toBe(firstNode);
    expect(observed).toContain(firstNode);
    expect(observed).toContain(secondNode);
    emitStageWidth(1500);
    expect(latest?.userDismissed).toBe(true);
    expect(latest?.isDocked).toBe(false);
  });
});
