// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SURFACE_HOST_ATTRIBUTE, acquireSurfaceHosts, placeSurfaceHosts } from './surface-pool.js';

function makeHost(viewId: string): HTMLDivElement {
  const host = document.createElement('div');
  host.setAttribute(SURFACE_HOST_ATTRIBUTE, viewId);
  return host;
}

describe('docking surface pool', () => {
  it('reuses one host node per view across group moves', () => {
    const hosts = new Map<string, HTMLDivElement>([['v1', makeHost('v1')]]);
    const slotA = document.createElement('div');
    const slotB = document.createElement('div');
    const pool = document.createElement('div');
    const identity = hosts.get('v1');

    placeSurfaceHosts({ hosts, pool, placement: { viewToSlot: new Map([['v1', slotA]]) } });
    expect(slotA.contains(hosts.get('v1') ?? null)).toBe(true);

    placeSurfaceHosts({ hosts, pool, placement: { viewToSlot: new Map([['v1', slotB]]) } });
    expect(slotB.contains(hosts.get('v1') ?? null)).toBe(true);
    expect(slotA.contains(hosts.get('v1') ?? null)).toBe(false);
    expect(hosts.get('v1')).toBe(identity);
  });

  it('parks unmounted views in the pool instead of detaching them', () => {
    const hosts = new Map<string, HTMLDivElement>([['v1', makeHost('v1')], ['v2', makeHost('v2')]]);
    const slot = document.createElement('div');
    const pool = document.createElement('div');
    placeSurfaceHosts({ hosts, pool, placement: { viewToSlot: new Map([['v1', slot]]) } });
    expect(slot.contains(hosts.get('v1') ?? null)).toBe(true);
    expect(pool.contains(hosts.get('v2') ?? null)).toBe(true);
    expect(hosts.get('v2')?.isConnected).toBe(false);
  });

  it('creates and releases hosts as the view set changes', () => {
    const hosts = new Map<string, HTMLDivElement>();
    expect(acquireSurfaceHosts(hosts, ['v1', 'v2'])).toBe(true);
    expect(acquireSurfaceHosts(hosts, ['v1', 'v2'])).toBe(false);
    expect([...hosts.keys()]).toEqual(['v1', 'v2']);
    expect(acquireSurfaceHosts(hosts, ['v2'])).toBe(true);
    expect([...hosts.keys()]).toEqual(['v2']);
  });
});
