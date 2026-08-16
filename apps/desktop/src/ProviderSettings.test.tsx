/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { DesktopLocaleProvider } from './desktop-locale-context.js';
import { ProviderSettings, type ProviderSettingsProps } from './ProviderSettings.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    media: { maxPasteBytes: 1_000_000, allowedMimeTypes: [] },
    artifact: { enabled: true, triggerMode: 'automatic', decisionPrompt: { mode: 'default', customPrompt: '' }, maxBytes: 1_000_000 },
    providers: [
      {
        id: 'openai',
        protocol: 'openai-compatible',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyRef: 'openai-keychain-ref',
        enabled: true,
        models: [{ id: 'gpt-4.1', contextWindow: 128000, maxOutputTokens: 32768 }],
      },
      {
        id: 'custom-local',
        protocol: 'openai-compatible',
        name: 'Local',
        baseUrl: 'http://127.0.0.1:8317/v1',
        enabled: false,
        models: [],
      },
    ],
  };
}

function renderProviderSettings(props: ProviderSettingsProps): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <ProviderSettings {...props} />
          </DesktopLocaleProvider>
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  return { container, root };
}

function makeProps(
  onSave: ProviderSettingsProps['onSave'] = vi.fn(async () => true),
): ProviderSettingsProps {
  return {
    config: makeConfig(),
    saving: false,
    onSave,
    onError: vi.fn(),
    onInfo: vi.fn(),
    onDiscoverModels: vi.fn(async () => ({
      providerId: 'openai',
      protocol: 'openai-compatible' as const,
      models: [],
    })),
    onTestModel: vi.fn(async () => ({ durationMs: 100 })),
    onStoreSecret: vi.fn(async (providerId) => `keychain-${providerId}`),
    searchCatalog: vi.fn(async () => []),
  };
}

describe('ProviderSettings', () => {
  let instances: { container: HTMLDivElement; root: Root }[] = [];
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    instances = [];
  });

  afterEach(() => {
    for (const { container, root } of instances) {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders the BYOK provider list with search and add buttons', () => {
    const { container, root } = renderProviderSettings(makeProps());
    instances.push({ container, root });
    expect(container.querySelector('[data-testid="provider-settings"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-search-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-add-open"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-add-block"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-row-openai"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-row-custom-local"]')).not.toBeNull();
  });

  it('hides the untested provider state and labels enlarged model actions', () => {
    const { container, root } = renderProviderSettings(makeProps());
    instances.push({ container, root });

    const openaiRow = container.querySelector('[data-testid="provider-row-openai"]');
    expect(openaiRow?.querySelector('.provider-status-pill')).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-row-expand-openai"]')
        ?.click();
    });

    const expandButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-model-expand-gpt-4.1"]',
    );
    const testButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-model-test-gpt-4.1"]',
    );
    const removeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-model-remove-gpt-4.1"]',
    );

    expect(expandButton?.getAttribute('aria-label')).toBe('Expand');
    expect(expandButton?.getAttribute('aria-expanded')).toBe('false');
    expect(testButton?.title).toBe('Test');
    expect(testButton?.getAttribute('aria-label')).toBe('Test');
    expect(removeButton?.title).toBe('Delete');
    expect(removeButton?.getAttribute('aria-label')).toBe('Delete');
    // The pencil edit icon was removed in favor of the row dropdown.
    expect(
      container.querySelector('[data-testid="provider-model-edit-gpt-4.1"]'),
    ).toBeNull();
  });

  it('opens the provider editor when the edit button is clicked', () => {
    const { container, root } = renderProviderSettings(makeProps());
    instances.push({ container, root });
    const openBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-row-open-openai"]',
    );
    expect(openBtn).not.toBeNull();
    act(() => {
      openBtn?.click();
    });
    expect(container.querySelector('[data-testid="provider-drawer"]')).not.toBeNull();
    expect(container.querySelector('.provider-editor-modal')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-baseurl-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-test-connection"]')).not.toBeNull();
  });

  it('opens the provider editor when the chevron button is clicked', () => {
    const { container, root } = renderProviderSettings(makeProps());
    instances.push({ container, root });
    const openBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-row-open-openai"]',
    );
    expect(openBtn).not.toBeNull();
    act(() => {
      openBtn?.click();
    });
    expect(container.querySelector('[data-testid="provider-drawer"]')).not.toBeNull();
    expect(container.querySelector('.provider-editor-modal')).not.toBeNull();
  });

  it('filters rows by enabled/disabled', () => {
    const { container, root } = renderProviderSettings(makeProps());
    instances.push({ container, root });
    expect(container.querySelectorAll('.provider-row')).toHaveLength(2);

    const onFilter = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-filter-on"]',
    );
    expect(onFilter).not.toBeNull();
    act(() => {
      onFilter?.click();
    });
    expect(container.querySelectorAll('.provider-row')).toHaveLength(1);

    const offFilter = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-filter-off"]',
    );
    expect(offFilter).not.toBeNull();
    act(() => {
      offFilter?.click();
    });
    expect(container.querySelectorAll('.provider-row')).toHaveLength(1);
  });

  it('updates base url through the drawer connection form', async () => {
    const { container, root } = renderProviderSettings(makeProps());
    instances.push({ container, root });
    const openBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-row-open-openai"]',
    );
    act(() => {
      openBtn?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="provider-baseurl-input"]',
    );
    expect(input).not.toBeNull();
    act(() => {
      setInputValue(input, 'https://new.example.com/v1');
    });
    expect(input?.value).toBe('https://new.example.com/v1');
  });

  it('toggles provider enabled from the list and saves', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const { container, root } = renderProviderSettings(makeProps(onSave));
    instances.push({ container, root });
    const rowSwitch = container.querySelector<HTMLElement>(
      '[data-testid="provider-enable-switch-openai"]',
    );
    expect(rowSwitch).not.toBeNull();
    await act(async () => {
      rowSwitch?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSave).toHaveBeenCalled();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const openai = saved?.providers.find((p: ModelProviderConfig) => p.id === 'openai');
    expect(openai).toBeTruthy();
    expect(openai?.enabled).toBe(false);
  });

  it('saves a new base url from the drawer', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const { container, root } = renderProviderSettings(makeProps(onSave));
    instances.push({ container, root });
    const openBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-row-open-openai"]',
    );
    act(() => {
      openBtn?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="provider-baseurl-input"]',
    );
    act(() => {
      setInputValue(input, 'https://new.example.com/v1');
    });
    const saveBtn = container.querySelector<HTMLButtonElement>('[data-testid="provider-save-btn"]');
    expect(saveBtn).not.toBeNull();
    await act(async () => {
      saveBtn?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSave).toHaveBeenCalled();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const openai = saved?.providers.find((p: ModelProviderConfig) => p.id === 'openai');
    expect(openai?.baseUrl).toBe('https://new.example.com/v1');
  });

  it('opens add dialog, picks a preset, and opens a new-provider drawer', async () => {
    const { container, root } = renderProviderSettings(makeProps());
    instances.push({ container, root });
    const addBtn = container.querySelector<HTMLButtonElement>('[data-testid="provider-add-open"]');
    await act(async () => {
      addBtn?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Mantine Modal portals into document.body.
    const scope = document.body;
    expect(scope.querySelector('[data-testid="provider-preset-picker"]')).not.toBeNull();
    expect(scope.querySelector('[data-testid="provider-preset-deepseek"]')).not.toBeNull();
    expect(scope.querySelector('[data-testid="provider-preset-qwen"]')).not.toBeNull();
    expect(scope.querySelector('[data-testid="provider-preset-azure"]')).not.toBeNull();

    const deepseek = scope.querySelector<HTMLButtonElement>(
      '[data-testid="provider-preset-deepseek"]',
    );
    await act(async () => {
      deepseek?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="provider-drawer"]')).not.toBeNull();
    // New providers always show the name field.
    expect(container.querySelector('[data-testid="provider-name-input"]')).not.toBeNull();
  });

  it('adds a second config for an already-configured preset with a unique id and name', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const { container, root } = renderProviderSettings(makeProps(onSave));
    instances.push({ container, root });

    const addBtn = container.querySelector<HTMLButtonElement>('[data-testid="provider-add-open"]');
    await act(async () => {
      addBtn?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 'openai' is already configured in makeConfig(), so picking the preset
    // must allocate a second instance instead of erroring out.
    const openaiPreset = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="provider-preset-openai"]',
    );
    expect(openaiPreset).not.toBeNull();
    await act(async () => {
      openaiPreset?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const nameInput = container.querySelector<HTMLInputElement>(
      '[data-testid="provider-name-input"]',
    );
    expect(nameInput?.value).toBe('OpenAI 2');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="provider-save-btn"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onSave).toHaveBeenCalled();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    expect(saved?.providers.map((provider) => provider.id)).toContain('openai-2');
    const second = saved?.providers.find((provider) => provider.id === 'openai-2');
    expect(second?.name).toBe('OpenAI 2');
    expect(second?.protocol).toBe('openai-compatible');
  });

  it('filters providers by search query', () => {
    const { container, root } = renderProviderSettings(makeProps());
    instances.push({ container, root });
    const search = container.querySelector<HTMLInputElement>(
      '[data-testid="provider-search-input"]',
    );
    expect(search).not.toBeNull();
    act(() => {
      setInputValue(search, 'openai');
    });
    expect(container.querySelectorAll('.provider-row')).toHaveLength(1);
    expect(container.querySelector('[data-testid="provider-row-openai"]')).not.toBeNull();
  });

  it('tests connection from the drawer and surfaces status', async () => {
    const onDiscoverModels = vi.fn(async () => ({
      providerId: 'openai',
      protocol: 'openai-compatible' as const,
      models: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }],
    }));
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const props = makeProps(onSave);
    props.onDiscoverModels = onDiscoverModels;
    const { container, root } = renderProviderSettings(props);
    instances.push({ container, root });
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-row-open-openai"]')
        ?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const apiKeyInput = container.querySelector<HTMLInputElement>(
      '[data-testid="provider-apikey-input"]',
    );
    expect(apiKeyInput).not.toBeNull();
    act(() => {
      setInputValue(apiKeyInput, '123456');
    });
    const testBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-test-connection"]',
    );
    expect(testBtn).not.toBeNull();
    await act(async () => {
      testBtn?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onDiscoverModels).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai' }),
      { apiKey: '123456' },
    );
    expect(props.onStoreSecret).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="provider-save-btn"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(props.onStoreSecret).toHaveBeenCalledWith('openai', '123456');
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const provider = saved.providers.find((item) => item.id === 'openai');
    expect(provider?.apiKeyRef).toBe('keychain-openai');
    expect(provider?.apiKeyEnv).toBeUndefined();
    expect(props.onInfo).toHaveBeenCalled();
  });

  it('discovers models from the expanded provider row on the models page', async () => {
    const onDiscoverModels = vi.fn(async () => ({
      providerId: 'openai',
      protocol: 'openai-compatible' as const,
      models: [
        { id: 'gpt-4.1', label: 'GPT-4.1' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      ],
    }));
    const props = makeProps();
    props.onDiscoverModels = onDiscoverModels;
    const { container, root } = renderProviderSettings(props);
    instances.push({ container, root });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-row-expand-openai"]')
        ?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="provider-row-models-openai"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-model-list"]')).not.toBeNull();

    const discoverBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-discover-models-openai"]',
    );
    expect(discoverBtn).not.toBeNull();
    await act(async () => {
      discoverBtn?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onDiscoverModels).toHaveBeenCalled();
    const search = document.querySelector<HTMLInputElement>(
      '[data-testid="discover-models-search"]',
    );
    expect(search).not.toBeNull();

    await act(async () => {
      search?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      search?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      search?.focus();
      setInputValue(search, 'mini');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-testid="discover-models-search"]')).not.toBeNull();
    expect(search?.value).toBe('mini');
  });

  it('edits a provider model from the expanded row and persists immediately', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const props = makeProps(onSave);
    const { container, root } = renderProviderSettings(props);
    instances.push({ container, root });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-row-expand-openai"]')
        ?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-model-expand-gpt-4.1"]')
        ?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const contextInput = container.querySelector<HTMLInputElement>(
      '[data-testid="model-edit-context"]',
    );
    const outputInput = container.querySelector<HTMLInputElement>(
      '[data-testid="model-edit-output"]',
    );
    expect(contextInput).not.toBeNull();
    expect(outputInput).not.toBeNull();

    act(() => {
      setInputValue(contextInput, '256000');
      setInputValue(outputInput, '16000');
    });

    act(() => {
      container
        .querySelector<HTMLInputElement>('[data-testid="model-edit-image-generation"]')
        ?.click();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="model-edit-save"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onSave).toHaveBeenCalled();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const openai = saved?.providers.find((p: ModelProviderConfig) => p.id === 'openai');
    const gpt = openai?.models.find((m) => m.id === 'gpt-4.1');
    expect(gpt).toEqual(
      expect.objectContaining({
        contextWindow: 256000,
        maxOutputTokens: 16000,
        capabilities: ['image-generation'],
      }),
    );
  });

  it('saves a model parameter change from the expanded row when clicking save', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const props = makeProps(onSave);
    const { container, root } = renderProviderSettings(props);
    instances.push({ container, root });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-row-expand-openai"]')
        ?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-model-expand-gpt-4.1"]')
        ?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const contextInput = container.querySelector<HTMLInputElement>(
      '[data-testid="model-edit-context"]',
    );
    expect(contextInput).not.toBeNull();

    act(() => {
      setInputValue(contextInput, '256000');
    });

    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="model-edit-save"]')?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onSave).toHaveBeenCalled();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const openai = saved?.providers.find((p: ModelProviderConfig) => p.id === 'openai');
    const gpt = openai?.models.find((m) => m.id === 'gpt-4.1');
    expect(gpt).toEqual(expect.objectContaining({ contextWindow: 256000 }));
  });
});
