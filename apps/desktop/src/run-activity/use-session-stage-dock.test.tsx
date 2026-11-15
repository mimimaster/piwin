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

  public observe(): void {}

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
  it('resolves thresholds per conversation width', () => {
    expect(sessionDockThresholdPx('narrow')).toBe(640 + 56 + 296);
    expect(sessionDockThresholdPx('default')).toBe(720 + 56 + 296);
    expect(sessionDockThresholdPx('wide')).toBe(840 + 56 + 296);
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

    emitStageWidth(1071);
    expect(latest?.canAutoDock).toBe(false);
    expect(latest?.isDocked).toBe(false);

    emitStageWidth(1072);
    expect(latest?.canAutoDock).toBe(true);
    expect(latest?.isDocked).toBe(true);
  });

  it('honours the narrow and wide measures', () => {
    renderDock({ conversationWidth: 'narrow' });
    emitStageWidth(992);
    expect(latest?.isDocked).toBe(true);

    act(() => root.render(<Probe conversationWidth="wide" hasAnyContent suppressed={false} />));
    emitStageWidth(1191);
    expect(latest?.isDocked).toBe(false);
    emitStageWidth(1192);
    expect(latest?.isDocked).toBe(true);
  });

  it('stays closed without content or while suppressed', () => {
    renderDock({ hasAnyContent: false });
    emitStageWidth(1400);
    expect(latest?.canAutoDock).toBe(true);
    expect(latest?.isDocked).toBe(false);

    act(() => root.render(<Probe conversationWidth="default" hasAnyContent suppressed />));
    emitStageWidth(1400);
    expect(latest?.canAutoDock).toBe(false);
    expect(latest?.isDocked).toBe(false);
  });

  it('dismisses, toggles back, and forgives the dismissal on re-widening', () => {
    renderDock({});
    emitStageWidth(1400);
    expect(latest?.isDocked).toBe(true);

    act(() => latest?.dismiss());
    expect(latest?.userDismissed).toBe(true);
    expect(latest?.isDocked).toBe(false);
    expect(latest?.canAutoDock).toBe(true);

    act(() => latest?.toggle());
    expect(latest?.isDocked).toBe(true);

    act(() => latest?.dismiss());
    expect(latest?.isDocked).toBe(false);

    // Narrow below the threshold, then widen again: dismissal resets.
    emitStageWidth(800);
    expect(latest?.canAutoDock).toBe(false);
    emitStageWidth(1400);
    expect(latest?.canAutoDock).toBe(true);
    expect(latest?.userDismissed).toBe(false);
    expect(latest?.isDocked).toBe(true);
  });
});
