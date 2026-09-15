/**
 * `React.memo` for components whose function props are event handlers only.
 *
 * Workbench parents rebuild inline closures on every chat reducer commit, so a
 * plain memo never bails out while a run streams. This wrapper hands the child
 * one stable proxy per function prop; each proxy calls the closure from the
 * latest parent render, so handlers never go stale while data props alone
 * decide whether the child re-renders.
 *
 * Invariant: never use it for render props or callbacks the child calls during
 * render — a stable proxy hides identity changes those callers rely on.
 */
import {
  memo,
  useInsertionEffect,
  useRef,
  type ComponentType,
  type ReactElement,
} from 'react';

type CallbackProxy = (...args: unknown[]) => unknown;

export function memoWithLatestCallbacks<Props extends object>(
  Component: ComponentType<Props>,
): ComponentType<Props> {
  const MemoizedComponent = memo(Component);

  function LatestCallbacksBoundary(props: Props): ReactElement {
    const latestPropsRef = useRef<Props>(props);
    // Insertion effects run before any layout effect, so a child effect that
    // invokes a handler on commit already sees this render's closure.
    useInsertionEffect(() => {
      latestPropsRef.current = props;
    });
    const proxiesRef = useRef(new Map<string, CallbackProxy>());

    const stableProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (typeof value !== 'function') {
        stableProps[key] = value;
        continue;
      }
      let proxy = proxiesRef.current.get(key);
      if (proxy === undefined) {
        proxy = (...args: unknown[]): unknown => {
          const latest = (latestPropsRef.current as Record<string, unknown>)[key];
          return typeof latest === 'function' ? (latest as CallbackProxy)(...args) : undefined;
        };
        proxiesRef.current.set(key, proxy);
      }
      stableProps[key] = proxy;
    }

    return <MemoizedComponent {...(stableProps as Props)} />;
  }

  LatestCallbacksBoundary.displayName = `memoWithLatestCallbacks(${
    Component.displayName ?? Component.name ?? 'Component'
  })`;
  return LatestCallbacksBoundary;
}
