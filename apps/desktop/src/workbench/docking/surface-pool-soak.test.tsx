// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { acquireSurfaceHosts, placeSurfaceHosts } from './surface-pool.js';

function Probe(): ReactElement {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-testid="docking-soak-probe" onClick={() => setCount((value) => value + 1)}>
      {count}
    </button>
  );
}

describe('docking surface soak', () => {
  it('keeps one host node across 20 group moves', () => {
    const hosts = new Map<string, HTMLDivElement>();
    acquireSurfaceHosts(hosts, ['v1']);
    const identity = hosts.get('v1');
    const slots = [document.createElement('div'), document.createElement('div'), document.createElement('div')];
    const pool = document.createElement('div');
    for (let index = 0; index < 20; index += 1) {
      const slot = slots[index % slots.length];
      if (!slot) throw new Error('missing slot');
      placeSurfaceHosts({ hosts, pool, placement: { viewToSlot: new Map([['v1', slot]]) } });
      expect(hosts.get('v1')).toBe(identity);
      expect(slot.contains(identity ?? null)).toBe(true);
    }
  });

  it('preserves React state across 20 host reparents', async () => {
    const hosts = new Map<string, HTMLDivElement>();
    acquireSurfaceHosts(hosts, ['v1']);
    const host = hosts.get('v1');
    if (!host) throw new Error('missing host');
    const slots = [document.createElement('div'), document.createElement('div')];
    const pool = document.createElement('div');
    document.body.append(slots[0]!, slots[1]!, pool, host);
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(createPortal(<Probe />, host));
    });
    const button = host.querySelector('button');
    if (!button) throw new Error('missing probe');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(button.textContent).toBe('1');
    for (let index = 0; index < 20; index += 1) {
      const slot = slots[index % 2];
      if (!slot) throw new Error('missing slot');
      placeSurfaceHosts({ hosts, pool, placement: { viewToSlot: new Map([['v1', slot]]) } });
    }
    expect(hosts.get('v1')).toBe(host);
    expect(host.querySelector('button')?.textContent).toBe('1');
    await act(async () => {
      root.unmount();
    });
  });
});
