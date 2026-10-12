// @vitest-environment happy-dom
/**
 * Multi-tab right panel (Cursor-style strip).
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostResponse, SessionSummary, SubagentInvocation } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { RightPanel, selectMountedRightPanelTabs, type RightPanelTab } from './right-panel';
import { useSurfaceTitlebar } from './surface-titlebar.js';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { RIGHT_PANEL_STATE_STORAGE_KEY, writeStoredRightPanelState } from './right-panel-memory';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { SubAgentPanel } from './SubAgentPanel';
import { MAX_RECENT_TASK_ITEMS } from './subagent-tasks-overview';

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

function BrowserBodyWithPageTabs(props: { count: number }) {
  const titlebar = useSurfaceTitlebar();
  useEffect(() => {
    titlebar?.setPageTabCount?.(props.count);
  }, [props.count, titlebar]);
  return <div data-testid="browser-body">browser</div>;
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
    expect(container.querySelector('[data-testid="right-panel-tab-add"]')).toBeNull();
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
    expect(container.querySelector('[data-testid="right-panel-home-tasks"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="right-panel-home-"]').length).toBe(6);
    expect(container.querySelectorAll('.right-panel-home-shortcut').length).toBe(5);
    expect(container.querySelector('[data-testid="right-panel-tab-add"]')).toBeNull();
  });

  it('shows the + picker only after a tool tab is open', () => {
    writeStoredRightPanelState({ openTabs: [], activeTab: null });
    let activeTab: RightPanelTab | null = null;
    const rendered = renderPanel({
      activeTab: null,
      onTabChange: (tab) => {
        activeTab = tab;
      },
    });
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="right-panel-tab-add"]')).toBeNull();

    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="right-panel-home-files"]')?.click();
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

    expect(container.querySelector('[data-testid="right-panel-tab-add"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="files-body"]')).not.toBeNull();
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
    expect(document.querySelector('[data-testid="right-panel-plus-review"]')).toBeNull();

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
    const expandGlyph = expandBtn?.querySelector('svg');
    expect(expandGlyph?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(expandGlyph?.getAttribute('width')).toBe('14');
    expect(expandGlyph?.getAttribute('height')).toBe('14');

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
    const compressGlyph = expandBtn?.querySelector('svg');
    expect(compressGlyph?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(compressGlyph?.innerHTML).toContain('M5 9h4V5');
  });

  it('keeps tool tabs while Side Chat is active', () => {
    writeStoredRightPanelState({ openTabs: ['files', 'sideChat'], activeTab: 'sideChat' });
    const rendered = renderPanel({
      activeTab: 'sideChat',
      sideChatContent: <div data-testid="side-chat-body">side</div>,
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="right-panel-open-tab-sideChat"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-open-tab-files"]')).not.toBeNull();
    const slot = container.querySelector('[data-testid="right-panel-side-chat-tabs-slot"]');
    expect(slot?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('[data-testid="side-chat-body"]')).not.toBeNull();
  });

  it('opens a second instance beside the first instead of focusing it', () => {
    writeStoredRightPanelState({ openTabs: ['browser'], activeTab: 'browser' });
    let activeTab: RightPanelTab | null = 'browser';
    const rendered = renderPanel({
      activeTab: 'browser',
      onTabChange: (tab) => {
        activeTab = tab;
      },
      browserContent: <div data-testid="browser-body">browser</div>,
    });
    root = rendered.root;
    container = rendered.container;

    const plusButton = container.querySelector<HTMLButtonElement>('[data-testid="right-panel-tab-add"]');
    act(() => {
      plusButton?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      plusButton?.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      plusButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const item = document.querySelector<HTMLElement>('[data-testid="right-panel-plus-browser"]');
    expect(item?.textContent).not.toContain('已打开');
    act(() => {
      item?.click();
    });

    expect(activeTab).toBe('browser-2');
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="browser-2"
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
            browserContent={<div data-testid="browser-body">browser</div>}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="right-panel-open-tab-browser"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-open-tab-browser-2"]')?.textContent).toContain('浏览器 2');
    const labels = [...container.querySelectorAll('.right-panel-tab-label')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['浏览器', '浏览器 2']);
  });

  it('hands a docked browser opened from + to the host instead of opening it twice', () => {
    writeStoredRightPanelState({ openTabs: ['files'], activeTab: 'files' });
    const onOpenInstance = vi.fn();
    const rendered = renderPanel({
      activeTab: 'files',
      handedOffTabs: ['browser', 'review', 'canvas', 'docPreview'],
      onOpenInstance,
    });
    root = rendered.root;
    container = rendered.container;

    const plusButton = container.querySelector<HTMLButtonElement>('[data-testid="right-panel-tab-add"]');
    act(() => {
      plusButton?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      plusButton?.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      plusButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    act(() => {
      document.querySelector<HTMLElement>('[data-testid="right-panel-plus-browser"]')?.click();
    });

    expect(onOpenInstance).toHaveBeenCalledTimes(1);
    expect(onOpenInstance).toHaveBeenCalledWith('browser');
    expect(container.querySelector('[data-testid="right-panel-open-tab-browser"]')).toBeNull();
  });

  it('keeps the browser tool tab closeable when there are no page tabs', () => {
    writeStoredRightPanelState({ openTabs: ['browser'], activeTab: 'browser' });
    const rendered = renderPanel({
      activeTab: 'browser',
      browserContent: <div data-testid="browser-body">browser</div>,
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="right-panel-open-tab-browser"]')).not.toBeNull();
    const tabstrip = container.querySelector('[data-testid="right-panel-tabstrip"]');
    expect(tabstrip?.classList.contains('has-browser-actions')).toBe(true);
    const tabsSlot = container.querySelector('[data-testid="right-panel-side-chat-tabs-slot"]');
    const actionsSlot = container.querySelector('[data-testid="right-panel-surface-actions-slot"]');
    expect(tabsSlot?.hasAttribute('hidden')).toBe(true);
    expect(actionsSlot?.hasAttribute('hidden')).toBe(false);
    expect(tabstrip?.querySelector('[data-testid="right-panel-tab-add"]')).not.toBeNull();

    const closeBrowser = container.querySelector<HTMLButtonElement>(
      '[data-testid="right-panel-close-tab-browser"]',
    );
    expect(closeBrowser).not.toBeNull();
    act(() => closeBrowser?.click());
    expect(container.querySelector('[data-testid="browser-body"]')).toBeNull();
  });

  it('keeps the browser tool tab while page tabs exist', () => {
    writeStoredRightPanelState({ openTabs: ['browser', 'files'], activeTab: 'browser' });
    const rendered = renderPanel({
      activeTab: 'browser',
      browserContent: <BrowserBodyWithPageTabs count={1} />,
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="right-panel-open-tab-browser"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-open-tab-files"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="browser-body"]')).not.toBeNull();
  });

  it('lists docked tools beside its own tabs and hosts them in one shared slot', () => {
    writeStoredRightPanelState({ openTabs: ['files'], activeTab: 'files' });
    const slots: Array<HTMLElement | null> = [];
    const onClose = vi.fn();
    let activeTab: RightPanelTab | null = 'canvas';
    const rendered = renderPanel({
      activeTab: 'canvas',
      onTabChange: (tab) => {
        activeTab = tab;
      },
      handedOffTabs: ['browser', 'review', 'canvas', 'docPreview'],
      dockedTools: {
        tabs: ['canvas'],
        groupId: 'right-group',
        labels: { canvas: 'Pricing page' },
        onClose,
        slotRef: (node) => slots.push(node),
        panelRef: () => {},
        onTitlebarChange: () => {},
      },
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="right-panel-open-tab-files"]')).not.toBeNull();
    const canvasTab = container.querySelector('[data-testid="right-panel-open-tab-canvas"]');
    expect(canvasTab?.textContent).toContain('Pricing page');
    const tabWrapper = canvasTab?.closest('[data-docking-right-tab]');
    expect(tabWrapper?.getAttribute('data-docking-right-tab-group')).toBe('right-group');
    expect(tabWrapper?.getAttribute('data-docking-right-tab-index')).toBe('0');

    const body = container.querySelector<HTMLElement>('[data-testid="right-panel-docked-body"]');
    expect(body?.hidden).toBe(false);
    expect(slots.at(-1)).toBe(body);
    expect(container.querySelector('[data-testid="files-body"]')).toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="right-panel-close-tab-canvas"]')
        ?.click();
    });
    expect(onClose).toHaveBeenCalledWith('canvas');
    expect(activeTab).toBe('files');
  });

  it('lends the titlebar slots to a docked browser only while it is active', () => {
    writeStoredRightPanelState({ openTabs: [], activeTab: null });
    const titlebars: unknown[] = [];
    const rendered = renderPanel({
      activeTab: 'browser',
      handedOffTabs: ['browser', 'review', 'canvas', 'docPreview'],
      dockedTools: {
        tabs: ['browser'],
        groupId: 'right-group',
        onClose: () => {},
        slotRef: () => {},
        panelRef: () => {},
        onTitlebarChange: (titlebar) => titlebars.push(titlebar),
      },
    });
    root = rendered.root;
    container = rendered.container;

    const tabstrip = container.querySelector('[data-testid="right-panel-tabstrip"]');
    expect(tabstrip?.classList.contains('has-browser-actions')).toBe(true);
    expect(titlebars.at(-1)).toEqual(
      expect.objectContaining({
        tabsSlot: container.querySelector('[data-testid="right-panel-side-chat-tabs-slot"]'),
        actionsSlot: container.querySelector('[data-testid="right-panel-surface-actions-slot"]'),
      }),
    );
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

  it('shows aggregate task counts on the tab without raw run ids', async () => {
    writeStoredRightPanelState({ openTabs: ['tasks'], activeTab: 'tasks' });
    const running: SubagentInvocation = {
      id: 'inv-live',
      parentSessionId: 'parent-1',
      runId: 'run-secret-id',
      taskId: 'task-live',
      task: 'Scout repo',
      title: 'Scout repo',
      role: 'scout',
      status: 'running',
      revision: 1,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:02:00.000Z',
      activity: { kind: 'thinking' },
    };
    const completed: SubagentInvocation = {
      id: 'inv-done',
      parentSessionId: 'parent-1',
      runId: 'run-secret-id',
      taskId: 'task-done',
      task: 'Review auth',
      title: 'Review auth',
      role: 'reviewer',
      status: 'completed',
      revision: 1,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:01:00.000Z',
      activity: { kind: 'completed', summary: 'Finished review' },
    };
    const request = vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'session/list-children',
      success: true,
      data: { sessions: [] },
    }));

    const rendered = renderPanel({
      activeTab: 'tasks',
      tasksActiveCount: 1,
      tasksContent: (
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <SubAgentPanel
            parentSessionId="parent-1"
            request={request}
            onOpenSession={() => {}}
            children={[]}
            invocations={{ [running.id]: running, [completed.id]: completed }}
            batches={{ 'run-secret-id': { runId: 'run-secret-id', status: 'running', results: [] } }}
          />
        </DesktopLocaleProvider>
      ),
    });
    root = rendered.root;
    container = rendered.container;

    const tab = container.querySelector('[data-testid="right-panel-open-tab-tasks"]');
    expect(tab?.textContent).toContain('任务');
    expect(tab?.querySelector('.right-panel-tab-badge')?.textContent).toBe('1');
    expect(container.textContent).toContain('后台任务 2 · 运行中 1 · 已完成 1');
    expect(container.textContent).toContain('scout · Scout repo');
    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session/list-children' }),
    );
  });

  it('drops terminal children from the active badge while keeping bounded history', async () => {
    writeStoredRightPanelState({ openTabs: [], activeTab: null });
    const request = vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'session/list-children',
      success: true,
      data: { sessions: [] },
    }));
    const completed = Array.from({ length: MAX_RECENT_TASK_ITEMS + 2 }, (_, index): SubagentInvocation => ({
      id: `inv-done-${index}`,
      parentSessionId: 'parent-1',
      runId: `run-done-${index}`,
      taskId: `task-done-${index}`,
      task: `Done ${index}`,
      title: `Done ${index}`,
      status: 'completed',
      revision: 1,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: `2026-09-13T00:${String(index).padStart(2, '0')}:00.000Z`,
      activity: { kind: 'completed', summary: `Finished ${index}` },
      childSessionId: `child-done-${index}`,
    }));
    const running: SubagentInvocation = {
      id: 'inv-live',
      parentSessionId: 'parent-1',
      runId: 'run-1',
      taskId: 'task-live',
      task: 'Still working',
      title: 'Still working',
      status: 'running',
      revision: 1,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T01:00:00.000Z',
      activity: { kind: 'thinking' },
    };
    const child = (id: string, name: string, updatedAt: string): SessionSummary => ({
      id,
      scope: { kind: 'project', projectPath: '/tmp/project' },
      workingDirectory: '/tmp/worktree',
      projectPath: '/tmp/project',
      name,
      updatedAt,
      messageCount: 1,
      parentSessionId: 'parent-1',
      kind: 'subagent',
      subagentStatus: 'done',
    });

    const rendered = renderPanel({
      open: true,
      activeTab: null,
      tasksActiveCount: 1,
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="right-panel-home-tasks-badge"]')?.textContent).toBe(
      '1',
    );

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="tasks"
            onTabChange={() => {}}
            panelWidthPx={320}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
            tasksActiveCount={1}
            tasksContent={
              <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
                <SubAgentPanel
                  parentSessionId="parent-1"
                  request={request}
                  onOpenSession={() => {}}
                  children={completed.map((item, index) =>
                    child(`child-done-${index}`, `Done ${index}`, item.updatedAt),
                  )}
                  invocations={Object.fromEntries(
                    [...completed, running].map((item) => [item.id, item]),
                  )}
                  batches={{ 'run-1': { runId: 'run-1', status: 'running', results: [] } }}
                />
              </DesktopLocaleProvider>
            }
          />
        </PiwinUiProvider>,
      );
    });

    expect(
      container.querySelector('[data-testid="right-panel-open-tab-tasks"] .right-panel-tab-badge')
        ?.textContent,
    ).toBe('1');
    expect(container.querySelectorAll('[data-testid="subagent-task-row"]').length).toBe(
      MAX_RECENT_TASK_ITEMS + 1,
    );
    expect(container.textContent).toContain('Still working');

    const settled: SubagentInvocation = {
      ...running,
      status: 'completed',
      updatedAt: '2026-09-13T01:01:00.000Z',
      activity: { kind: 'completed', summary: 'Wrapped up' },
    };

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="tasks"
            onTabChange={() => {}}
            panelWidthPx={320}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
            tasksActiveCount={0}
            tasksContent={
              <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
                <SubAgentPanel
                  parentSessionId="parent-1"
                  request={request}
                  onOpenSession={() => {}}
                  children={[
                    ...completed.map((item, index) =>
                      child(`child-done-${index}`, `Done ${index}`, item.updatedAt),
                    ),
                    child('child-live', 'Still working', settled.updatedAt),
                  ]}
                  invocations={Object.fromEntries(
                    [...completed, settled].map((item) => [item.id, item]),
                  )}
                  batches={{ 'run-1': { runId: 'run-1', status: 'completed', results: [] } }}
                />
              </DesktopLocaleProvider>
            }
          />
        </PiwinUiProvider>,
      );
    });

    expect(
      container.querySelector('[data-testid="right-panel-open-tab-tasks"] .right-panel-tab-badge'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="subagent-active-batches"]')).toBeNull();
    expect(container.querySelector('[data-testid="subagent-tasks-recent"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="subagent-task-row"]').length).toBe(
      MAX_RECENT_TASK_ITEMS,
    );
    expect(container.textContent).toContain('Still working');
  });
});
