// @vitest-environment happy-dom
/**
 * The right workspace's Summary state: the empty panel opens on the overview,
 * and an open tool can return to it without closing the tool's tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { RightPanel } from './right-panel';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { RIGHT_PANEL_STATE_STORAGE_KEY } from './right-panel-memory';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  // Tab state is session-scoped; clear both so no test inherits another tab.
  localStorage.clear();
  sessionStorage.clear();
});

function renderPanel(props: Partial<Parameters<typeof RightPanel>[0]> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <RightPanel
          open
          onOpen={() => {}}
          onClose={() => {}}
          activeTab={null}
          onTabChange={() => {}}
          panelWidthPx={360}
          isResizing={false}
          onResizePointerDown={() => {}}
          onResizeReset={() => {}}
          filesContent={<div data-testid="files-body">files</div>}
          terminalContent={<div data-testid="terminal-body">terminal</div>}
          reviewContent={<div data-testid="review-body">review</div>}
          summaryContent={<div data-testid="summary-body">summary</div>}
          {...props}
        />
      </PiwinUiProvider>,
    );
  });
  return container;
}

afterEach(() => {
  if (root && container) {
    act(() => root?.unmount());
    container.remove();
  }
  root = undefined;
  container = undefined;
});

describe('RightPanel summary state', () => {
  it('opens on the summary when no tool tab is open', () => {
    const el = renderPanel();
    expect(el.querySelector('[data-testid="summary-body"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="right-panel-home"]')).toBeNull();
  });

  it('adds the summary tab when the shell opens the panel on it', () => {
    const el = renderPanel({ open: false, activeTab: null });

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="summary"
            onTabChange={() => {}}
            panelWidthPx={360}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
            summaryContent={<div data-testid="summary-body">summary</div>}
          />
        </PiwinUiProvider>,
      );
    });

    expect(el.querySelector('[data-testid="summary-body"]')?.textContent).toBe('summary');
    expect(
      el.querySelector('[data-testid="right-panel-open-tab-summary"]'),
    ).not.toBeNull();
  });

  it('focuses the live browser instance instead of opening a second one', () => {
    // `browser-2` is the tab holding the page; the shell asks for `browser`.
    sessionStorage.setItem(
      RIGHT_PANEL_STATE_STORAGE_KEY,
      JSON.stringify({ openTabs: ['browser-2'], activeTab: 'browser-2' }),
    );
    const onTabChange = vi.fn();
    renderPanel({ open: false, activeTab: null, onTabChange });

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RightPanel
            open
            onOpen={() => {}}
            onClose={() => {}}
            activeTab="browser"
            onTabChange={onTabChange}
            panelWidthPx={360}
            isResizing={false}
            onResizePointerDown={() => {}}
            onResizeReset={() => {}}
            filesContent={<div data-testid="files-body">files</div>}
            terminalContent={<div data-testid="terminal-body">terminal</div>}
            reviewContent={<div data-testid="review-body">review</div>}
            browserContent={<div data-testid="browser-body">browser</div>}
            summaryContent={<div data-testid="summary-body">summary</div>}
          />
        </PiwinUiProvider>,
      );
    });

    expect(onTabChange).toHaveBeenCalledWith('browser-2');
    expect(
      container?.querySelectorAll('[data-testid^="right-panel-open-tab-"]').length,
    ).toBe(1);
  });

  it('falls back to the tool launcher when no summary body is wired', () => {
    const el = renderPanel({ summaryContent: undefined });
    expect(el.querySelector('[data-testid="right-panel-home"]')).not.toBeNull();
  });
});
