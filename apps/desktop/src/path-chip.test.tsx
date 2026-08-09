// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { PathChip } from './path-chip';
import type { PromptContextRef } from '@piwin/contracts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderPathChip(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
  });
  return { container, root };
}

function openContextMenu(trigger: HTMLElement): void {
  act(() => {
    trigger.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
  });
}

describe('PathChip context menu (CM-06)', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
    document.body.innerHTML = '';
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  function menuItem(testId: string): HTMLElement | null {
    return document.body.querySelector(`[data-testid="${testId}"]`);
  }

  it('opens the catalog menu with Open / Add to Chat / Copy paths', () => {
    const rendered = renderPathChip(
      <PathChip
        fullPath="/p/src/a.ts"
        label="a.ts"
        projectPath="/p"
        relativePath="src/a.ts"
        data-testid="path-chip-a"
        onOpen={() => undefined}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector('[data-testid="path-chip-a"]') as HTMLElement | null;
    expect(trigger).not.toBeNull();
    openContextMenu(trigger as HTMLElement);

    expect(menuItem('context-menu-open')).not.toBeNull();
    expect(menuItem('context-menu-add-to-chat')).not.toBeNull();
    expect(menuItem('context-menu-copy-relative-path')).not.toBeNull();
    expect(menuItem('context-menu-copy-absolute-path')).not.toBeNull();
    // Reveal is hidden when the OS reveal hook is not wired (canReveal false).
    expect(menuItem('context-menu-reveal')).toBeNull();
  });

  it('Add to Chat calls onAddContextRef with a file ref', () => {
    const onAddContextRef = vi.fn();
    const rendered = renderPathChip(
      <PathChip
        fullPath="/p/src/a.ts"
        label="a.ts"
        projectPath="/p"
        relativePath="src/a.ts"
        data-testid="path-chip-a"
        onOpen={() => undefined}
        onAddContextRef={onAddContextRef}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    openContextMenu(container.querySelector('[data-testid="path-chip-a"]') as HTMLElement);
    const addItem = menuItem('context-menu-add-to-chat') as HTMLElement | null;
    expect(addItem).not.toBeNull();
    act(() => {
      addItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAddContextRef).toHaveBeenCalledTimes(1);
    const ref = onAddContextRef.mock.calls[0]?.[0] as PromptContextRef;
    expect(ref).toMatchObject({
      kind: 'file',
      projectPath: '/p',
      relativePath: 'src/a.ts',
    });
  });

  it('Open triggers the chip open handler', () => {
    const onOpen = vi.fn();
    const rendered = renderPathChip(
      <PathChip
        fullPath="/p/src/a.ts"
        label="a.ts"
        projectPath="/p"
        data-testid="path-chip-a"
        onOpen={onOpen}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    openContextMenu(container.querySelector('[data-testid="path-chip-a"]') as HTMLElement);
    const openItem = menuItem('context-menu-open') as HTMLElement | null;
    expect(openItem).not.toBeNull();
    act(() => {
      openItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('Copy Relative Path writes the relative path to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: writeText,
      configurable: true,
      writable: true,
    });
    const rendered = renderPathChip(
      <PathChip
        fullPath="/p/src/a.ts"
        label="a.ts"
        projectPath="/p"
        relativePath="src/a.ts"
        data-testid="path-chip-a"
        onOpen={() => undefined}
        onAddContextRef={() => undefined}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    openContextMenu(container.querySelector('[data-testid="path-chip-a"]') as HTMLElement);
    const copyItem = menuItem('context-menu-copy-relative-path') as HTMLElement | null;
    expect(copyItem).not.toBeNull();
    act(() => {
      copyItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith('src/a.ts');
  });
});
