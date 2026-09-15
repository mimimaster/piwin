import { useEffect, useRef, useState } from 'react';

export const SURFACE_HOST_ATTRIBUTE = 'data-docking-surface';
export const SURFACE_HOST_CLASS = 'docking-surface-host';

export type SurfacePlacement = {
  /** Visible host target per view; views absent here stay in the pool but mounted. */
  viewToSlot: ReadonlyMap<string, HTMLElement>;
};

function createHost(viewId: string): HTMLDivElement {
  const host = document.createElement('div');
  host.className = SURFACE_HOST_CLASS;
  host.setAttribute(SURFACE_HOST_ATTRIBUTE, viewId);
  return host;
}

/**
 * One DOM node per view id, reused for the whole lifetime of the view.
 *
 * React portals target these nodes, so a view that changes group, tab, or
 * maximize state keeps its component instance and in-flight state; only the
 * node's parent changes. This is the anti-reparent guarantee.
 */
export function acquireSurfaceHosts(
  hosts: Map<string, HTMLDivElement>,
  viewIds: readonly string[],
  create: (viewId: string) => HTMLDivElement = createHost,
): boolean {
  let changed = false;
  const wanted = new Set(viewIds);
  for (const viewId of [...hosts.keys()]) {
    if (wanted.has(viewId)) continue;
    hosts.get(viewId)?.remove();
    hosts.delete(viewId);
    changed = true;
  }
  for (const viewId of viewIds) {
    if (hosts.has(viewId)) continue;
    hosts.set(viewId, create(viewId));
    changed = true;
  }
  return changed;
}

export function placeSurfaceHosts(args: {
  hosts: Map<string, HTMLDivElement>;
  pool: HTMLElement | null;
  placement: SurfacePlacement;
}): void {
  const { hosts, pool, placement } = args;
  for (const [viewId, host] of hosts) {
    const slot = placement.viewToSlot.get(viewId) ?? pool;
    if (!slot) continue;
    if (host.parentElement === slot) continue;
    slot.appendChild(host);
  }
}

export function useDockingSurfaceHosts(viewIds: readonly string[]): Map<string, HTMLDivElement> {
  const hostsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [, bump] = useState(0);
  const signature = viewIds.join('\u0000');

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const changed = acquireSurfaceHosts(hostsRef.current, signature === '' ? [] : signature.split('\u0000'));
    if (changed) bump((value) => value + 1);
  }, [signature]);

  return hostsRef.current;
}
