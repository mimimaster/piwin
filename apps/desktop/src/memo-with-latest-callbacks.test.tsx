// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useLayoutEffect, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { memoWithLatestCallbacks } from './memo-with-latest-callbacks.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type ProbeProps = {
  label: string;
  onPick: (value: string) => string;
  onOptional?: (() => void) | undefined;
  renders: { count: number };
  capture: { onPick?: (value: string) => string; hasOptional?: boolean };
};

function Probe(props: ProbeProps): ReactElement {
  props.renders.count += 1;
  props.capture.onPick = props.onPick;
  props.capture.hasOptional = typeof props.onOptional === 'function';
  return <span data-testid="probe">{props.label}</span>;
}

const MemoProbe = memoWithLatestCallbacks(Probe);

describe('memoWithLatestCallbacks', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('skips re-render when only inline callback identities change', () => {
    const renders = { count: 0 };
    const capture: ProbeProps['capture'] = {};
    act(() => {
      root.render(
        <MemoProbe label="a" onPick={(value) => `first:${value}`} renders={renders} capture={capture} />,
      );
    });
    act(() => {
      root.render(
        <MemoProbe label="a" onPick={(value) => `second:${value}`} renders={renders} capture={capture} />,
      );
    });

    expect(renders.count).toBe(1);
    // The retained proxy forwards to the closure from the latest parent render.
    expect(capture.onPick?.('x')).toBe('second:x');
  });

  it('re-renders when a data prop changes and keeps the proxy identity', () => {
    const renders = { count: 0 };
    const capture: ProbeProps['capture'] = {};
    act(() => {
      root.render(<MemoProbe label="a" onPick={(v) => v} renders={renders} capture={capture} />);
    });
    const firstProxy = capture.onPick;
    act(() => {
      root.render(<MemoProbe label="b" onPick={(v) => v} renders={renders} capture={capture} />);
    });

    expect(renders.count).toBe(2);
    expect(container.textContent).toBe('b');
    expect(capture.onPick).toBe(firstProxy);
  });

  it('passes an optional callback through only while the parent provides one', () => {
    const renders = { count: 0 };
    const capture: ProbeProps['capture'] = {};
    act(() => {
      root.render(
        <MemoProbe label="a" onPick={(v) => v} onOptional={() => {}} renders={renders} capture={capture} />,
      );
    });
    expect(capture.hasOptional).toBe(true);
    act(() => {
      root.render(<MemoProbe label="a" onPick={(v) => v} renders={renders} capture={capture} />);
    });
    expect(capture.hasOptional).toBe(false);
  });

  it('exposes the latest closure to child layout effects on commit', () => {
    const seen: string[] = [];
    function EffectProbe(props: { tick: number; onCommit: () => void }): ReactElement {
      useLayoutEffect(() => {
        props.onCommit();
      }, [props.tick, props.onCommit]);
      return <span />;
    }
    const MemoEffectProbe = memoWithLatestCallbacks(EffectProbe);
    act(() => {
      root.render(<MemoEffectProbe tick={1} onCommit={() => seen.push('one')} />);
    });
    act(() => {
      root.render(<MemoEffectProbe tick={2} onCommit={() => seen.push('two')} />);
    });

    expect(seen).toEqual(['one', 'two']);
  });
});
