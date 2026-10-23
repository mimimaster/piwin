// @vitest-environment happy-dom
import { describe, expect, it, vi,  } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  WindowDragRegion,
  isWindowDragBlockedTarget,
  handleNativeWindowDragMouseDown,
} from './native-window-drag';

describe('native-window-drag', () => {
  it('blocks real controls but allows empty drag strips', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="context-titlebar-box">
        <button id="btn">x</button>
        <div id="strip" class="context-bar-drag"></div>
        <span id="title">Session</span>
        <div class="context-bar-leading">
          <span id="spacer" class="proto-nav-spacer" data-tauri-drag-region></span>
          <div class="context-bar-history" data-no-window-drag>
            <button id="back">←</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    expect(isWindowDragBlockedTarget(host.querySelector('#btn'))).toBe(true);
    expect(isWindowDragBlockedTarget(host.querySelector('#strip'))).toBe(false);
    expect(isWindowDragBlockedTarget(host.querySelector('#title'))).toBe(false);
    expect(isWindowDragBlockedTarget(host.querySelector('#spacer'))).toBe(false);
    expect(isWindowDragBlockedTarget(host.querySelector('#back'))).toBe(true);
    host.remove();
  });

  it('renders a tauri drag region attribute', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<WindowDragRegion className="drag-fixture" data-testid="drag" />);
    });
    const node = container.querySelector('[data-testid="drag"]');
    expect(node).not.toBeNull();
    expect(node?.hasAttribute('data-tauri-drag-region')).toBe(true);
    act(() => root.unmount());
    container.remove();
  });

  it('does not throw outside Tauri when mousedown fires', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const event = {
      button: 0,
      defaultPrevented: false,
      target,
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent<HTMLElement>;
    expect(() => handleNativeWindowDragMouseDown(event)).not.toThrow();
    target.remove();
  });
});
