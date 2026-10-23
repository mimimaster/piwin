import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * A callback whose identity never changes and which always runs the closure
 * from the latest render. For event handlers handed across a memo boundary —
 * never for a function the receiver calls while rendering.
 */
export function useLatestCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latestRef = useRef(callback);
  // Insertion effects run before layout effects, so a child effect that fires
  // the handler on commit already sees this render's closure.
  useInsertionEffect(() => {
    latestRef.current = callback;
  });
  return useCallback((...args: Args) => latestRef.current(...args), []);
}
