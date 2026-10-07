import { useInsertionEffect, useRef } from 'react';
import { isStructurallyEqual } from './use-structural-value.js';

type Handler = (...args: unknown[]) => unknown;

/**
 * A stable object for values that mix data with event handlers — typically a
 * context value assembled from callbacks whose identity changes every render.
 *
 * Function members become proxies that never change identity and always call
 * the member from the latest render; the returned object keeps its reference
 * while the remaining members are structurally equal. So consumers re-render
 * for data, not because a handler was re-created.
 *
 * Only for handlers invoked from events or effects. A function the consumer
 * calls while rendering must not be hidden behind a stable proxy unless the
 * data it reads lives in the same object (which then changes the reference).
 */
export function useStableHandlers<Value extends object | null>(value: Value): Value {
  const latestRef = useRef(value);
  // Insertion effects run before layout effects, so a handler fired from a
  // child's commit already reaches this render's closure.
  useInsertionEffect(() => {
    latestRef.current = value;
  });
  const proxiesRef = useRef(new Map<string, Handler>());
  const stableRef = useRef<Value | null>(null);
  if (value === null) {
    stableRef.current = null;
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (typeof member !== 'function') {
      next[key] = member;
      continue;
    }
    let proxy = proxiesRef.current.get(key);
    if (proxy === undefined) {
      proxy = (...args: unknown[]): unknown => {
        const latest = (latestRef.current as Record<string, unknown> | null)?.[key];
        return typeof latest === 'function' ? (latest as Handler)(...args) : undefined;
      };
      proxiesRef.current.set(key, proxy);
    }
    next[key] = proxy;
  }
  if (stableRef.current === null || !isStructurallyEqual(stableRef.current, next)) {
    stableRef.current = next as Value;
  }
  return stableRef.current;
}
