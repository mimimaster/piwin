// @vitest-environment happy-dom
/**
 * When browser chrome merges into a host titlebar, that bar already has a +
 * (open another tool). New tab must not render as a second plus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { HostClient } from './host-client';
import { BrowserSessionPanel } from './browser-session-panel';
import { SurfaceTitlebarProvider } from './surface-titlebar.js';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';

describe('BrowserSessionChrome host titlebar', () => {
  let container: HTMLElement;
  let root: Root;
  let tabsSlot: HTMLElement;
  let actionsSlot: HTMLElement;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    tabsSlot = document.createElement('div');
    actionsSlot = document.createElement('div');
    document.body.append(container, tabsSlot, actionsSlot);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      root.unmount();
    });
    container.remove();
    tabsSlot.remove();
    actionsSlot.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('keeps new tab in ⋯ instead of a second titlebar plus', async () => {
    const hostClient = new HostClient({ transport: 'mock' });
    const tree: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SurfaceTitlebarProvider value={{ tabsSlot, actionsSlot }}>
          <BrowserSessionPanel hostClient={hostClient} onAddWebElement={vi.fn()} />
        </SurfaceTitlebarProvider>
      </PiwinUiProvider>
    );
    act(() => {
      root.render(tree);
    });

    expect(document.querySelector('[data-testid="browser-session-new-tab"]')).toBeNull();
    expect(tabsSlot.querySelector('[data-testid="browser-session-tabs"]')).not.toBeNull();

    const more = document.querySelector<HTMLButtonElement>('[data-testid="browser-session-more"]');
    expect(more).not.toBeNull();
    await act(async () => {
      more?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      more?.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      more?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[data-testid="browser-session-more-new-tab"]')).not.toBeNull();
  });

  it('closes the host browser tool when the last page tab is closed', async () => {
    const hostClient = new HostClient({ transport: 'mock' });
    const closeHost = vi.fn();
    const tree: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SurfaceTitlebarProvider value={{ tabsSlot, actionsSlot, closeHost }}>
          <BrowserSessionPanel hostClient={hostClient} onAddWebElement={vi.fn()} />
        </SurfaceTitlebarProvider>
      </PiwinUiProvider>
    );
    act(() => {
      root.render(tree);
    });

    const listeners = (hostClient as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'browser/state',
          lifecycle: 'ready',
          mirror: 'streaming',
          generation: 1,
          pageId: 'page-1',
          tabs: [
            {
              pageId: 'page-1',
              url: 'https://example.com',
              title: 'Example',
              kind: 'page',
              active: true,
            },
          ],
          ts: Date.now(),
        });
      }
    });

    const closeTab = document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-session-tab-close-page-1"]',
    );
    expect(closeTab).not.toBeNull();
    expect(closeTab?.disabled).toBe(false);
    await act(async () => {
      closeTab?.click();
    });
    expect(closeHost).toHaveBeenCalledTimes(1);
  });
});
