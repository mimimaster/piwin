// @vitest-environment happy-dom
/**
 * Multi-tab right panel (Cursor-style strip).
 */

import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { RightPanel, selectMountedRightPanelTabs, type RightPanelTab } from './right-panel';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { RIGHT_PANEL_STATE_STORAGE_KEY, writeStoredRightPanelState } from './right-panel-memory';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderPanel(props: Partial<Parameters<typeof RightPanel>[0]> = {}): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <RightPanel
          open
          onOpen={() => {}}
          onClose={() => {}}
          activeTab="terminal"
          onTabChange={() => {}}
          panelWidthPx={320}
          isResizing={false}
          onResizePointerDown={() => {}}
          onResizeReset={() => {}}
          filesContent={<div data-testid="files-body">files</div>}
          terminalContent={<div data-testid="terminal-body">terminal</div>}
          reviewContent={<div data-testid="review-body">review</div>}
          {...props}
        />
      </PiwinUiProvider>,
    );
  });
  return { container, root };
}

describe('RightPanel multi-tab', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    root = undefined;
    container = undefined;
    document.querySelectorAll('[data-testid="right-panel-plus-menu"]').forEach((node) => {
      node.remove();
    });
    try {
      sessionStorage.removeItem(RIGHT_PANEL_STATE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  });

  it('exposes resize handle and tab strip', () => {
    const rendered = renderPanel({ open: false });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="right-panel-resize-handle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-tabstrip"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-tab-add"]')).not.toBeNull();
  });

  it('shows the home launcher when the panel first expands without a requested tab', () => {
    // Mount closed so open-transition runs.
    const rendered = renderPanel({ open: false, activeTab: null });
    root = rendered.root;
    container = rendered.container;

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab={null}
            onTabChange={() => {}}
            panelWidthPx={320}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
          />
        </PiwinUiProvider>,
      );
    });

    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel?.getAttribute('data-view')).toBe('home');
    expect(container.querySelector('[data-testid="right-panel-home"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-home-terminal"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-home-cards"]')).toBeNull();
    expect(container.querySelector('[data-testid="right-panel-home-branches"]')).toBeNull();
    expect(container.querySelector('[data-testid="terminal-body"]')).toBeNull();
    expect(container.querySelector('[data-testid="right-panel-home-notes"]')).toBeNull();
    expect(container.querySelector('[data-testid="right-panel-home-sideChat"]')).not.toBeNull();
    expect(container.querySelector('.insp-h')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="right-panel-home-"]').length).toBe(5);
    expect(container.querySelectorAll('.right-panel-home-shortcut').length).toBe(5);
  });

  it('opens the shell-requested tab when the active tab changes as the panel expands', () => {
    // Mount closed with no active tab, then expand with an explicit tab request.
    const rendered = renderPanel({ open: false, activeTab: null });
    root = rendered.root;
    container = rendered.container;

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="terminal"
            onTabChange={() => {}}
            panelWidthPx={320}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
          />
        </PiwinUiProvider>,
      );
    });

    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel?.getAttribute('data-view')).toBe('detail');
    expect(container.querySelector('[data-testid="right-panel-open-tab-terminal"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="terminal-body"]')).not.toBeNull();
  });

  it('prioritizes an explicit Canvas reveal over a stored tab when expanding', () => {
    writeStoredRightPanelState({ openTabs: ['terminal'], activeTab: 'terminal' });
    const rendered = renderPanel({ open: false, activeTab: null });
    root = rendered.root;
    container = rendered.container;

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="canvas"
            onTabChange={() => {}}
            panelWidthPx={560}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
            canvasContent={<div data-testid="canvas-body">canvas</div>}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="right-panel-open-tab-terminal"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-open-tab-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="canvas-body"]')).not.toBeNull();
  });

  it('adds another tab from the + picker without dropping the first', () => {
    writeStoredRightPanelState({ openTabs: ['terminal'], activeTab: 'terminal' });
    let activeTab: RightPanelTab | null = 'terminal';
    const rendered = renderPanel({
      activeTab: 'terminal',
      onTabChange: (tab) => {
        activeTab = tab;
      },
    });
    root = rendered.root;
    container = rendered.container;

    const addBtn = container.querySelector<HTMLElement>('[data-testid="right-panel-tab-add"]');
    act(() => {
      // Radix DropdownMenu.Trigger opens on pointerdown, not a bare click.
      addBtn?.dispatchEvent(
        new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      addBtn?.dispatchEvent(
        new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }),
      );
      addBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[data-testid="right-panel-plus-menu"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="right-panel-plus-cards"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="right-panel-plus-notes"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="right-panel-plus-sideChat"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="right-panel-plus-branches"]')).toBeNull();

    const filesBtn = document.querySelector<HTMLElement>('[data-testid="right-panel-plus-files"]');
    act(() => {
      filesBtn?.click();
    });
    expect(activeTab).toBe('files');

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="files"
            onTabChange={(tab) => {
              activeTab = tab;
            }}
            panelWidthPx={320}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="right-panel-open-tab-terminal"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-open-tab-files"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="files-body"]')).not.toBeNull();
  });

  it('restores open tabs from sessionStorage on mount', () => {
    writeStoredRightPanelState({ openTabs: ['terminal', 'files'], activeTab: 'terminal' });
    const rendered = renderPanel({ activeTab: 'terminal' });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="right-panel-open-tab-terminal"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-open-tab-files"]')).not.toBeNull();
  });

  it('selects the active surface plus the explicit terminal keep-alive', () => {
    expect(selectMountedRightPanelTabs(['terminal', 'files', 'browser'], 'browser', true)).toEqual([
      'terminal',
      'browser',
    ]);
    expect(selectMountedRightPanelTabs(['files', 'browser'], 'browser', false)).toEqual([]);
    expect(selectMountedRightPanelTabs(['terminal', 'browser'], 'browser', false)).toEqual([
      'terminal',
    ]);
  });

  it('unmounts inactive non-terminal bodies instead of hiding their resource graphs', () => {
    writeStoredRightPanelState({
      openTabs: ['terminal', 'files', 'browser'],
      activeTab: 'browser',
    });
    const rendered = renderPanel({
      activeTab: 'browser',
      browserContent: <div data-testid="browser-body">browser</div>,
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="browser-body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="terminal-body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="files-body"]')).toBeNull();
  });

  it('unmounts collapsed non-terminal bodies while preserving an open terminal owner', () => {
    writeStoredRightPanelState({
      openTabs: ['terminal', 'browser'],
      activeTab: 'browser',
    });
    const rendered = renderPanel({
      open: false,
      activeTab: 'browser',
      browserContent: <div data-testid="browser-body">browser</div>,
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="browser-body"]')).toBeNull();
    expect(container.querySelector('[data-testid="terminal-body"]')).not.toBeNull();
  });

  it('marks the canvas tab body so CSS can hide a competing scrollport', () => {
    const rendered = renderPanel({ open: false, activeTab: null });
    root = rendered.root;
    container = rendered.container;

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="canvas"
            onTabChange={() => {}}
            panelWidthPx={320}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
            canvasContent={<div data-testid="canvas-body">canvas</div>}
          />
        </PiwinUiProvider>,
      );
    });

    const body = container.querySelector('#inspector-panel-canvas');
    expect(body?.getAttribute('data-right-panel-tab')).toBe('canvas');
    expect(container.querySelector('[data-testid="canvas-body"]')).not.toBeNull();
  });

  it('renders expand button and positions + button before tabs', () => {
    writeStoredRightPanelState({ openTabs: ['terminal'], activeTab: 'terminal' });
    let expandToggled = false;
    const rendered = renderPanel({
      activeTab: 'terminal',
      onToggleExpand: () => {
        expandToggled = true;
      },
    });
    root = rendered.root;
    container = rendered.container;

    const expandBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="right-panel-expand-btn"]',
    );
    expect(expandBtn).not.toBeNull();
    act(() => {
      expandBtn?.click();
    });
    expect(expandToggled).toBe(true);
    expect(expandBtn?.getAttribute('aria-label') ?? expandBtn?.textContent).toBeTruthy();
    expect(expandBtn?.getAttribute('title')).toBe('进入全屏');

    const tabstrip = container.querySelector('[data-testid="right-panel-tabstrip"]');
    const addBtn = tabstrip?.querySelector('[data-testid="right-panel-tab-add"]');
    const tabsContainer = tabstrip?.querySelector('.right-panel-tabs');
    expect(addBtn).not.toBeNull();
    expect(tabsContainer).not.toBeNull();
    // Verify + button comes before tabs container in DOM tree
    expect(tabstrip?.firstElementChild).toBe(addBtn);
    expect(container.querySelector('[data-testid="right-panel-close-btn"]')).toBeNull();
  });

  it('keeps the panel close control only in overlay presentation', () => {
    writeStoredRightPanelState({ openTabs: ['terminal'], activeTab: 'terminal' });
    let closed = false;
    const rendered = renderPanel({
      activeTab: 'terminal',
      isOverlayPresentation: true,
      onClose: () => {
        closed = true;
      },
    });
    root = rendered.root;
    container = rendered.container;

    const closeBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="right-panel-close-btn"]',
    );
    expect(closeBtn).not.toBeNull();
    act(() => {
      closeBtn?.click();
    });
    expect(closed).toBe(true);
  });

  it('labels the expand control as exit full screen when expanded', () => {
    writeStoredRightPanelState({ openTabs: ['terminal'], activeTab: 'terminal' });
    const rendered = renderPanel({
      activeTab: 'terminal',
      locale: 'en',
      isExpanded: true,
    });
    root = rendered.root;
    container = rendered.container;
    const expandBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="right-panel-expand-btn"]',
    );
    expect(expandBtn?.getAttribute('title')).toBe('Exit full screen');
    expect(expandBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('hides tool tabs while Side Chat owns the titlebar slot', () => {
    writeStoredRightPanelState({ openTabs: ['files', 'sideChat'], activeTab: 'sideChat' });
    const rendered = renderPanel({
      activeTab: 'sideChat',
      sideChatContent: <div data-testid="side-chat-body">side</div>,
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="right-panel-open-tab-sideChat"]')).toBeNull();
    expect(container.querySelector('[data-testid="right-panel-open-tab-files"]')).toBeNull();
    const tabstrip = container.querySelector('[data-testid="right-panel-tabstrip"]');
    expect(tabstrip?.classList.contains('has-side-chat-tabs')).toBe(true);
    const slot = container.querySelector('[data-testid="right-panel-side-chat-tabs-slot"]');
    expect(slot).not.toBeNull();
    expect(slot?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('[data-testid="side-chat-body"]')).not.toBeNull();
  });

  it('keeps the titlebar drag region after the side-chat slot so +/sync can pack to the tabs', () => {
    writeStoredRightPanelState({ openTabs: ['sideChat'], activeTab: 'sideChat' });
    const rendered = renderPanel({
      activeTab: 'sideChat',
      sideChatContent: <div data-testid="side-chat-body">side</div>,
    });
    root = rendered.root;
    container = rendered.container;

    const tabstrip = container.querySelector('[data-testid="right-panel-tabstrip"]');
    const slot = container.querySelector('[data-testid="right-panel-side-chat-tabs-slot"]');
    const drag = container.querySelector('[data-testid="right-panel-titlebar-drag"]');
    expect(tabstrip && slot && drag).toBeTruthy();
    const children = [...(tabstrip?.children ?? [])];
    expect(children.indexOf(slot as Element)).toBeLessThan(children.indexOf(drag as Element));
  });
});
