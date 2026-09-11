// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { setInputValue } from './workspace-subpages-test-helpers.js';
import { MarketplaceWorkspaceView } from './MarketplaceWorkspaceView.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('MarketplaceWorkspaceView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
  });

  function renderView(onClose = vi.fn()): void {
    const dummyRequest = vi.fn(async (_cmd: HostCommand): Promise<HostResponse> => ({
      type: 'response',
      command: 'ping',
      success: true,
      data: {},
    }));

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarketplaceWorkspaceView
            locale="zh-CN"
            onClose={onClose}
            request={dummyRequest}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders topbar, tab strip, and default extensions with compatibility badges', () => {
    renderView();

    // Verify root container has Inkstone native classes
    const stage = container.querySelector('.vault-stage.marketplace-stage');
    expect(stage).not.toBeNull();

    // Verify topbar title
    const title = container.querySelector('.vault-bar-context');
    expect(title?.textContent).toContain('扩展市场');

    // Verify runtime generation badge exists
    const genBadge = container.querySelector('.market-gen-badge');
    expect(genBadge?.textContent).toContain('Runtime Gen');

    // Verify default extensions are displayed
    const extCard = container.querySelector('[data-testid="market-ext-goal"]');
    expect(extCard).not.toBeNull();
    expect(extCard?.textContent).toContain('goal');
    expect(extCard?.textContent).toContain('原生兼容');

    // Verify degraded extension shows degraded badge
    const webAccessCard = container.querySelector('[data-testid="market-ext-pi-web-access"]');
    expect(webAccessCard).not.toBeNull();
    expect(webAccessCard?.textContent).toContain('降级可用');
  });

  it('supports tab switching between extensions, plugins, and installed', () => {
    renderView();

    const tabs = container.querySelectorAll<HTMLButtonElement>('.market-tab-btn');
    expect(tabs.length).toBe(3);

    // Switch to plugins
    const pluginsTab = tabs[1]!;
    act(() => {
      pluginsTab.click();
    });

    const pluginCard = container.querySelector('[data-testid="market-plugin-fullstack-web-suite"]');
    expect(pluginCard).not.toBeNull();
    expect(pluginCard?.textContent).toContain('Fullstack Web 专家插件包');

    // Switch to installed
    const installedTab = tabs[2]!;
    act(() => {
      installedTab.click();
    });

    const installedList = container.querySelector('.market-installed-list');
    expect(installedList).not.toBeNull();
    expect(installedList?.textContent).toContain('goal');
  });

  it('triggers onClose when clicking back button', () => {
    const onClose = vi.fn();
    renderView(onClose);

    const backBtn = container.querySelector<HTMLButtonElement>('[data-testid="marketplace-back-btn"]');
    expect(backBtn).not.toBeNull();
    act(() => {
      backBtn?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides incompatible extensions proactively, but shows them when searched with install disabled', () => {
    renderView();

    // In default view (no search), incompatible extension (pi-powerline-footer) is NOT rendered
    let powerlineCard = container.querySelector('[data-testid="market-ext-pi-powerline-footer"]');
    expect(powerlineCard).toBeNull();

    // When searching for "powerline", it appears in search results
    const searchInput = container.querySelector<HTMLInputElement>('input[data-testid="marketplace-search-input"]');
    expect(searchInput).not.toBeNull();
    act(() => {
      setInputValue(searchInput, 'powerline');
    });

    powerlineCard = container.querySelector('[data-testid="market-ext-pi-powerline-footer"]');
    expect(powerlineCard).not.toBeNull();
    expect(powerlineCard?.textContent).toContain('不兼容');
    expect(powerlineCard?.textContent).toContain('仅限终端 TUI');

    // Action button is disabled
    const installBtn = powerlineCard?.querySelector('button');
    expect(installBtn?.disabled).toBe(true);
    expect(installBtn?.textContent).toContain('不可安装');
  });
});
