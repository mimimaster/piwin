// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ModelProviderConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ProviderModelList } from './provider-model-list.js';

describe('ProviderModelList', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  const customProvider: ModelProviderConfig = {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      {
        id: 'anthropic/claude-3.5-sonnet',
        label: 'Claude 3.5 Sonnet',
        capabilities: ['chat'],
      },
    ],
  };

  const subscriptionProvider: ModelProviderConfig = {
    id: 'grok',
    name: 'Grok',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    source: 'subscription',
    models: [
      {
        id: 'grok-4.3',
        label: 'Grok 4.3',
        capabilities: ['chat'],
      },
    ],
  };

  function renderList(provider: ModelProviderConfig): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ProviderModelList
            provider={provider}
            defaultModelId={null}
            isChinese={true}
            disabled={false}
            modelTestStatus={{}}
            testingModelId={null}
            onUpdateModels={vi.fn()}
            onTestModel={vi.fn()}
            onSetDefaultModel={vi.fn()}
            onToggleModel={vi.fn()}
            onDiscoverModels={vi.fn(async () => ({
              providerId: provider.id,
              protocol: provider.protocol,
              models: [],
            }))}
          />
        </PiwinUiProvider>,
      );
    });
    return container;
  }

  function openMenu(button: HTMLElement | null) {
    if (!button) return;
    act(() => {
      button.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      button.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  it('renders remove button and fetch button for custom providers', () => {
    const container = renderList(customProvider);
    expect(container.querySelector('[data-testid="provider-discover-models-openrouter"]')).not.toBeNull();
    // Open the dropdown menu
    const moreBtn = container.querySelector<HTMLButtonElement>('[data-testid="provider-model-more-anthropic/claude-3.5-sonnet"]');
    expect(moreBtn).not.toBeNull();
    openMenu(moreBtn);
    expect(document.body.querySelector('[data-testid="provider-model-remove-anthropic/claude-3.5-sonnet"]')).not.toBeNull();
  });

  it('hides remove button and fetch button for subscription providers', () => {
    const container = renderList(subscriptionProvider);
    expect(container.querySelector('[data-testid="provider-discover-models-grok"]')).toBeNull();
    // Open the dropdown menu
    const moreBtn = container.querySelector<HTMLButtonElement>('[data-testid="provider-model-more-grok-4.3"]');
    expect(moreBtn).not.toBeNull();
    openMenu(moreBtn);
    expect(document.body.querySelector('[data-testid="provider-model-remove-grok-4.3"]')).toBeNull();
  });

  it('allows toggling all models on and off with one click', () => {
    const onUpdateModels = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ProviderModelList
            provider={subscriptionProvider}
            defaultModelId={null}
            isChinese={true}
            disabled={false}
            modelTestStatus={{}}
            testingModelId={null}
            onUpdateModels={onUpdateModels}
            onTestModel={vi.fn()}
            onSetDefaultModel={vi.fn()}
            onToggleModel={vi.fn()}
            onDiscoverModels={vi.fn(async () => ({
              providerId: subscriptionProvider.id,
              protocol: subscriptionProvider.protocol,
              models: [],
            }))}
          />
        </PiwinUiProvider>,
      );
    });

    const toggleAllBtn = container.querySelector<HTMLButtonElement>(
      `[data-testid="provider-toggle-all-models-${subscriptionProvider.id}"]`,
    );
    expect(toggleAllBtn).not.toBeNull();
    expect(toggleAllBtn?.textContent).toContain('全部停用');

    act(() => {
      toggleAllBtn?.click();
    });

    expect(onUpdateModels).toHaveBeenCalledWith([
      {
        id: 'grok-4.3',
        label: 'Grok 4.3',
        capabilities: ['chat'],
        enabled: false,
      },
    ]);
  });

  it('lists enabled models before disabled ones without changing config order', () => {
    const mixed: ModelProviderConfig = {
      ...subscriptionProvider,
      models: [
        { id: 'grok-4.3', label: 'Grok 4.3', capabilities: ['chat'], enabled: false },
        { id: 'grok-4.6', label: 'Grok 4.6', capabilities: ['chat'] },
        { id: 'grok-build-0.1', label: 'Grok Build 0.1', capabilities: ['chat'], enabled: false },
        { id: 'grok-4.5', label: 'Grok 4.5', capabilities: ['chat'], enabled: true },
      ],
    };
    const container = renderList(mixed);
    const names = [...container.querySelectorAll('[data-testid="provider-model-row"]')].map(
      (row) => row.getAttribute('aria-label'),
    );
    expect(names).toEqual([
      'Grok 4.6 · 编辑参数',
      'Grok 4.5 · 编辑参数',
      'Grok 4.3 · 编辑参数',
      'Grok Build 0.1 · 编辑参数',
    ]);
  });

});
