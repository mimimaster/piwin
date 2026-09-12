// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { flush, setInputValue } from './workspace-subpages-test-helpers.js';
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
    vi.useRealTimers();
  });

  function renderView(
    onClose = vi.fn(),
    request?: (command: HostCommand) => Promise<HostResponse>,
  ): void {
    const dummyRequest =
      request ??
      vi.fn(async (_cmd: HostCommand): Promise<HostResponse> => ({
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

  it('searches the Pi npm catalog when the local list has no match', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'marketplace/search') {
        return {
          type: 'response',
          command: 'marketplace/search',
          success: true,
          data: {
            query: command.query,
            hits: [
              {
                entryId: 'npm:pi-subagents',
                name: 'pi-subagents',
                version: '0.67.0',
                description: 'Pi extension for subagents',
                source: 'npm-pi-package',
                installCommand: 'pi install npm:pi-subagents',
                repositoryUrl: 'https://github.com/nicobailon/pi-subagents',
              },
            ],
          },
        };
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarketplaceWorkspaceView locale="zh-CN" onClose={vi.fn()} request={request} />
        </PiwinUiProvider>,
      );
    });

    const searchInput = container.querySelector<HTMLInputElement>(
      'input[data-testid="marketplace-search-input"]',
    );
    act(() => {
      setInputValue(searchInput, 'pi-subagents');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flush();

    expect(request).toHaveBeenCalledWith({ type: 'marketplace/search', query: 'pi-subagents' });
    const card = container.querySelector('[data-testid="market-npm-pi-subagents"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('pi install npm:pi-subagents');
    expect(container.querySelector('[data-testid="marketplace-empty"]')).toBeNull();
  });

  it('renders theme-conforming EmptyState with seal, query badge, and suggestion chips when search yields no results', async () => {
    vi.useFakeTimers();
    // Return empty results for ecosystem search
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'marketplace/search') {
        return {
          type: 'response',
          command: 'marketplace/search',
          success: true,
          data: { query: command.query, hits: [] },
        };
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarketplaceWorkspaceView locale="zh-CN" onClose={vi.fn()} request={request} />
        </PiwinUiProvider>,
      );
    });

    const searchInput = container.querySelector<HTMLInputElement>(
      'input[data-testid="marketplace-search-input"]',
    );
    act(() => {
      setInputValue(searchInput, 'non-existent-pkg');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flush();

    const emptyState = container.querySelector('[data-testid="marketplace-empty"]');
    expect(emptyState).not.toBeNull();
    expect(emptyState?.classList.contains('empty-state--spacious')).toBe(true);

    // Verify seal, badge, and title
    const seal = emptyState?.querySelector('.empty-state-seal');
    expect(seal).not.toBeNull();
    expect(seal?.textContent).toBe('寻');

    const badge = emptyState?.querySelector('.empty-state-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('non-existent-pkg');

    const title = emptyState?.querySelector('.empty-state-title');
    expect(title?.textContent).toContain('未找到匹配的扩展');

    // Verify suggestion chips
    const chip = emptyState?.querySelector<HTMLButtonElement>('.empty-state-suggestion-chip.is-clickable');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('清空关键词');

    // Clicking chip resets search
    act(() => {
      chip?.click();
    });
    expect(searchInput?.value).toBe('');
  });
});

