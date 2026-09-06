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
    expect(container.querySelector('[data-testid="right-panel-home-sideChat"]')).toBeNull();
    expect(container.querySelector('.insp-h')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="right-panel-home-"]').length).toBe(4);
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

    const tabstrip = container.querySelector('[data-testid="right-panel-tabstrip"]');
    const addBtn = tabstrip?.querySelector('[data-testid="right-panel-tab-add"]');
    const tabsContainer = tabstrip?.querySelector('.right-panel-tabs');
    expect(addBtn).not.toBeNull();
    expect(tabsContainer).not.toBeNull();
    // Verify + button comes before tabs container in DOM tree
    expect(tabstrip?.firstElementChild).toBe(addBtn);
  });
});
