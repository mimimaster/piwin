// @vitest-environment happy-dom
/**
 * Quiet Workbench W2/W4: directory → drill IA and terminal process affordances.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { RightPanel } from './right-panel';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';

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
          activeTab="files"
          onTabChange={() => {}}
          panelWidthPx={320}
          isResizing={false}
          onResizePointerDown={() => {}}
          onResizeReset={() => {}}
          filesContent={<div data-testid="files-body">files</div>}
          activityContent={<div data-testid="activity-body">activity</div>}
          reviewContent={<div data-testid="review-body">review</div>}
          {...props}
        />
      </PiwinUiProvider>,
    );
  });
  return { container, root };
}

describe('RightPanel quiet workbench IA', () => {
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
  });

  it('starts on directory home without process chevron or count', () => {
    const rendered = renderPanel({ runningProcessCount: 0 });
    root = rendered.root;
    container = rendered.container;

    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel?.getAttribute('data-view')).toBe('home');
    expect(panel?.getAttribute('data-open')).toBe('true');
    expect(container.querySelector('[data-testid="right-panel-directory"]')).not.toBeNull();
    expect(container.querySelector('.right-panel-section-chevron')).toBeNull();
    expect(container.querySelector('.right-panel-section-count.is-process')).toBeNull();
  });

  it('keep-mounts when closed so reopen can restore without remounting', () => {
    const rendered = renderPanel({ open: false, runningProcessCount: 0 });
    root = rendered.root;
    container = rendered.container;

    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-open')).toBe('false');
    expect(panel?.className).toContain('is-collapsed');
    // Directory still in DOM (keep-mount); collapsed CSS takes it out of layout/focus.
    expect(container.querySelector('[data-testid="right-panel-directory"]')).not.toBeNull();
  });

  it('shows terminal count + chevron only when processes are live', () => {
    const rendered = renderPanel({ runningProcessCount: 2 });
    root = rendered.root;
    container = rendered.container;

    const terminalRow = container.querySelector('[data-testid="right-panel-tab-activity"]');
    expect(terminalRow).not.toBeNull();
    expect(terminalRow?.className).toContain('has-proc');
    expect(terminalRow?.querySelector('.right-panel-section-count.is-process')?.textContent).toBe(
      '2',
    );
    expect(terminalRow?.querySelector('.right-panel-section-chevron')).not.toBeNull();

    // Non-terminal rows never get the process chevron.
    const filesRow = container.querySelector('[data-testid="right-panel-files-btn"]');
    expect(filesRow?.querySelector('.right-panel-section-chevron')).toBeNull();
  });

  it('drills into a section and returns via back control', () => {
    let activeTab: 'files' | 'activity' | 'review' | 'notes' | 'cards' = 'files';
    const rendered = renderPanel({
      activeTab,
      onTabChange: (tab) => {
        activeTab = tab;
      },
    });
    root = rendered.root;
    container = rendered.container;

    const filesBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="right-panel-files-btn"]',
    );
    expect(filesBtn).not.toBeNull();
    act(() => {
      filesBtn?.click();
    });

    expect(container.querySelector('[data-testid="right-panel"]')?.getAttribute('data-view')).toBe(
      'detail',
    );
    expect(container.querySelector('[data-testid="right-panel-directory"]')).toBeNull();
    expect(container.querySelector('[data-testid="files-body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="right-panel-back-btn"]')).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="right-panel-back-btn"]')
        ?.click();
    });

    expect(container.querySelector('[data-testid="right-panel"]')?.getAttribute('data-view')).toBe(
      'home',
    );
    expect(container.querySelector('[data-testid="right-panel-directory"]')).not.toBeNull();
    expect(activeTab).toBe('files');
  });

  it('shows terminal attention pulse on directory without auto-opening detail', () => {
    let cleared = false;
    const rendered = renderPanel({
      terminalAttention: true,
      onTerminalAttentionClear: () => {
        cleared = true;
      },
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="right-panel"]')?.getAttribute('data-view')).toBe(
      'home',
    );
    expect(
      container.querySelector('[data-testid="right-panel-terminal-attention"]'),
    ).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="right-panel-tab-activity"]')
        ?.click();
    });
    expect(cleared).toBe(true);
  });
});
