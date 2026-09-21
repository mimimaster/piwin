// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { PathChip, pathChipDisplayText } from './path-chip';
import type { PromptContextRef } from '@piwin/contracts';
import {
  DesktopContextMenuProvider,
  type ContextMenuDispatchers,
  type DesktopContextMenuValue,
} from './context-menu';
import { LocalFileActionsProvider } from './local-file-actions-context';

/**
 * Reveal is Tauri-only, so the missing-path branch is driven through an
 * override that defaults to the real implementation (browser → not-desktop).
 */
const revealOverride = vi.hoisted(() => ({
  impl: null as null | ((path: string) => Promise<unknown>),
}));

vi.mock('./local-file-actions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./local-file-actions.js')>();
  return {
    ...actual,
    revealLocalFileInFolder: (path: string) =>
      revealOverride.impl ? revealOverride.impl(path) : actual.revealLocalFileInFolder(path),
  };
});

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

function isMenuItemDisabled(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }
  return (
    element.getAttribute('aria-disabled') === 'true' ||
    element.getAttribute('data-disabled') === 'true'
  );
}

describe('pathChipDisplayText', () => {
  it('keeps an absolute path visible instead of collapsing to the file name', () => {
    expect(
      pathChipDisplayText(
        '/Users/me/proj/docs/design/inkstone-icons/generated-icons.html',
      ),
    ).toBe('/Users/me/proj/docs/design/inkstone-icons/generated-icons.html');
  });

  it('keeps a relative directory prefix', () => {
    expect(pathChipDisplayText('docs/design/generated-icons.html')).toBe(
      'docs/design/generated-icons.html',
    );
  });

  it('keeps a bare deliverable name', () => {
    expect(pathChipDisplayText('generated-icons.html')).toBe('generated-icons.html');
  });

  it('ignores a label that is only the basename of a longer path', () => {
    expect(
      pathChipDisplayText('/Users/me/proj/generated-icons.html', 'generated-icons.html'),
    ).toBe('/Users/me/proj/generated-icons.html');
  });

  it('keeps a custom link title', () => {
    expect(pathChipDisplayText('/Users/me/proj/notes.md', 'My Notes')).toBe('My Notes');
  });

  it('strips a file: prefix so the filesystem path is readable', () => {
    expect(pathChipDisplayText('file:///Users/me/out.zip')).toBe('/Users/me/out.zip');
  });
});

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
    revealOverride.impl = null;
    vi.restoreAllMocks();
  });

  function menuItem(testId: string): HTMLElement | null {
    return document.body.querySelector(`[data-testid="${testId}"]`);
  }

  it('opens the catalog menu with Open / Save As / Copy paths / Reveal', () => {
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
    expect(menuItem('context-menu-save-as')).not.toBeNull();
    expect(menuItem('context-menu-add-to-chat')).not.toBeNull();
    expect(menuItem('context-menu-copy-relative-path')).not.toBeNull();
    expect(menuItem('context-menu-copy-absolute-path')).not.toBeNull();
    expect(menuItem('context-menu-reveal')).not.toBeNull();
  });

  it('Copy Absolute Path writes the resolved path to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: writeText,
      configurable: true,
      writable: true,
    });
    const rendered = renderPathChip(
      <PathChip
        fullPath="out/a.zip"
        label="a.zip"
        projectPath="/p"
        data-testid="path-chip-a"
        onOpen={() => undefined}
        onAddContextRef={() => undefined}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    openContextMenu(container.querySelector('[data-testid="path-chip-a"]') as HTMLElement);
    const copyItem = menuItem('context-menu-copy-absolute-path') as HTMLElement | null;
    expect(copyItem).not.toBeNull();
    act(() => {
      copyItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith('/p/out/a.zip');
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

  it('disables Add to Chat when no add handler is available', () => {
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

    openContextMenu(container.querySelector('[data-testid="path-chip-a"]') as HTMLElement);
    const addItem = menuItem('context-menu-add-to-chat');
    expect(addItem).not.toBeNull();
    expect(isMenuItemDisabled(addItem)).toBe(true);
  });

  it('uses the desktop context menu to Add to Chat without an onAddContextRef prop', () => {
    const addToChat = vi.fn();
    const dispatchers: ContextMenuDispatchers = {
      addToChat,
      focusComposer: vi.fn(),
      sendPreset: vi.fn(),
      openPath: vi.fn(),
      revealPath: vi.fn(),
      copyText: vi.fn(),
      quoteInComposer: vi.fn(),
      retryMessage: vi.fn(),
      forkMessage: vi.fn(),
      openSideChat: vi.fn(),
      notify: vi.fn(),
    };
    const menuValue: DesktopContextMenuValue = {
      caps: {
        hasProject: true,
        canReveal: false,
        sideChatAvailable: false,
        applyAvailable: true,
        canSendPreset: false,
        locale: 'en',
      },
      dispatchers,
    };
    const rendered = renderPathChip(
      <DesktopContextMenuProvider value={menuValue}>
        <PathChip
          fullPath="cropped-portraits-16.zip"
          label="cropped-portraits-16.zip"
          projectPath="/p"
          data-testid="path-chip-a"
          onOpen={() => undefined}
        />
      </DesktopContextMenuProvider>,
    );
    root = rendered.root;
    container = rendered.container;

    openContextMenu(container.querySelector('[data-testid="path-chip-a"]') as HTMLElement);
    const addItem = menuItem('context-menu-add-to-chat') as HTMLElement | null;
    expect(addItem).not.toBeNull();
    expect(isMenuItemDisabled(addItem)).toBe(false);
    act(() => {
      addItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(addToChat).toHaveBeenCalledTimes(1);
    expect(addToChat.mock.calls[0]?.[0]).toMatchObject({
      kind: 'file',
      projectPath: '/p',
      relativePath: 'cropped-portraits-16.zip',
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

  it('tells the user reveal needs the desktop window in the browser preview', async () => {
    const onNotify = vi.fn();
    const rendered = renderPathChip(
      <PathChip
        fullPath="/p/src/a.ts"
        label="a.ts"
        projectPath="/p"
        relativePath="src/a.ts"
        data-testid="path-chip-a"
        onOpen={() => undefined}
        onNotify={onNotify}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    openContextMenu(container.querySelector('[data-testid="path-chip-a"]') as HTMLElement);
    const revealItem = menuItem('context-menu-reveal') as HTMLElement | null;
    expect(revealItem).not.toBeNull();
    act(() => {
      revealItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onNotify).toHaveBeenCalledWith(
      'Show in Finder needs the desktop window, not the browser preview.',
      'error',
    );
  });

  it('resolves the real file before revealing when the chip path has nothing', async () => {
    const onNotify = vi.fn();
    const request = vi.fn(async (command: { type: string; query?: string }) => ({
      type: 'response',
      command: command.type,
      success: true,
      data: {
        projectPath: '/p',
        query: command.query ?? '',
        matches: [{ relativePath: 'docs/real/shot.png' }],
        truncated: false,
      },
    }));
    const calls: string[] = [];
    revealOverride.impl = async (path) => {
      calls.push(path);
      if (path === '/p/shot.png') {
        return { ok: false, reason: 'missing' };
      }
      return { ok: true };
    };

    const rendered = renderPathChip(
      <LocalFileActionsProvider request={request as never}>
        <PathChip
          fullPath="shot.png"
          projectPath="/p"
          data-testid="path-chip-shot"
          onOpen={() => undefined}
          onNotify={onNotify}
        />
      </LocalFileActionsProvider>,
    );
    root = rendered.root;
    container = rendered.container;

    openContextMenu(container.querySelector('[data-testid="path-chip-shot"]') as HTMLElement);
    const revealItem = menuItem('context-menu-reveal') as HTMLElement | null;
    expect(revealItem).not.toBeNull();
    act(() => {
      revealItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalledWith({
      type: 'project/find-file',
      projectPath: '/p',
      query: 'shot.png',
    });
    expect(calls).toEqual(['/p/shot.png', '/p/docs/real/shot.png']);
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('says the path has no file when the Host cannot resolve it either', async () => {
    const onNotify = vi.fn();
    revealOverride.impl = async () => ({ ok: false, reason: 'missing' });

    const rendered = renderPathChip(
      <LocalFileActionsProvider
        request={async () => ({ type: 'response', success: false } as never)}
      >
        <PathChip
          fullPath="shot.png"
          projectPath="/p"
          data-testid="path-chip-shot"
          onOpen={() => undefined}
          onNotify={onNotify}
        />
      </LocalFileActionsProvider>,
    );
    root = rendered.root;
    container = rendered.container;

    openContextMenu(container.querySelector('[data-testid="path-chip-shot"]') as HTMLElement);
    act(() => {
      menuItem('context-menu-reveal')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onNotify).toHaveBeenCalledWith(
      'No file at that path — it may live in another project folder: /p/shot.png',
      'info',
    );
  });
});
