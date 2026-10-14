// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesktopCommandId } from './desktop-commands';
import { useDesktopShortcuts } from './use-desktop-shortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness(props: { onCommand: (id: DesktopCommandId) => void; onOpenPalette: () => void }): null {
  useDesktopShortcuts(props);
  return null;
}

describe('useDesktopShortcuts', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function mount(markup: string): { commands: DesktopCommandId[]; palette: { opened: number }; target: HTMLElement } {
    const commands: DesktopCommandId[] = [];
    const palette = { opened: 0 };
    container = document.createElement('div');
    container.innerHTML = markup;
    document.body.appendChild(container);
    const host = document.createElement('div');
    container.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <Harness onCommand={(id) => commands.push(id)} onOpenPalette={() => (palette.opened += 1)} />,
      );
    });
    const target = container.querySelector<HTMLElement>('textarea');
    if (!target) throw new Error('fixture needs a textarea');
    return { commands, palette, target };
  }

  function press(target: HTMLElement, init: KeyboardEventInit): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  }

  it('keeps ⌘ shortcuts live while the terminal has focus', () => {
    const { commands, target } = mount('<div class="xterm"><textarea></textarea></div>');
    press(target, { key: '\\', metaKey: true });
    press(target, { key: 'j', metaKey: true });
    expect(commands).toEqual(['toggle-right-panel', 'open-activity']);
  });

  it('leaves every Ctrl chord to the shell inside the terminal', () => {
    const { commands, palette, target } = mount('<div class="xterm"><textarea></textarea></div>');
    press(target, { key: 'k', ctrlKey: true });
    press(target, { key: 'j', ctrlKey: true });
    press(target, { key: '\\', ctrlKey: true });
    expect(commands).toEqual([]);
    expect(palette.opened).toBe(0);
  });

  it('still ignores action shortcuts while typing in an ordinary field', () => {
    const { commands, palette, target } = mount('<textarea></textarea>');
    press(target, { key: '\\', metaKey: true });
    press(target, { key: 'k', metaKey: true });
    expect(commands).toEqual([]);
    expect(palette.opened).toBe(1);
  });
});
