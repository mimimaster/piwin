import { useLayoutEffect, useState, type ReactElement, type ReactNode } from 'react';

/** Restored metadata must not initialize a tool before its first presentation. */
export function DeferredDockingSurface(props: { visible: boolean; children: ReactNode }): ReactElement | null {
  const [presented, setPresented] = useState(props.visible);
  useLayoutEffect(() => {
    if (props.visible) setPresented(true);
  }, [props.visible]);
  // Keep a visited surface alive across tab changes/reparents: it may own live work.
  return props.visible || presented ? <>{props.children}</> : null;
}
