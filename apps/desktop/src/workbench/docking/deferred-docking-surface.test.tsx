// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DeferredDockingSurface } from './deferred-docking-surface.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('restored docked tools', () => {
  it('does not mount unopened tools, and retains an activated tool and its state through hides', async () => {
    const mounted = vi.fn();
    const released = vi.fn();
    function Tool() {
      const [count, setCount] = useState(0);
      useEffect(() => { mounted(); return released; }, []);
      return <button onClick={() => setCount((value) => value + 1)}>{count}</button>;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = async (visible: boolean) => {
      await act(async () => { root.render(<DeferredDockingSurface visible={visible}><Tool /></DeferredDockingSurface>); });
    };
    try {
      await render(false);
      expect(mounted).not.toHaveBeenCalled();
      expect(container.childElementCount).toBe(0);
      await render(true);
      const button = container.querySelector('button');
      if (button === null) throw new Error('tool did not mount on activation');
      await act(async () => { button.click(); });
      for (let index = 0; index < 20; index++) await render(index % 2 === 0);
      expect(mounted).toHaveBeenCalledOnce();
      expect(released).not.toHaveBeenCalled();
      expect(container.querySelector('button')).toBe(button);
      expect(button.textContent).toBe('1');
    } finally {
      await act(async () => { root.unmount(); });
    }
    expect(released).toHaveBeenCalledOnce();
  });
});
