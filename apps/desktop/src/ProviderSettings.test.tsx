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
import { SettingsProvider, type SettingsContextValue } from './settings/settings-context.js';

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

function readSwitch(
  container: HTMLElement,
  testId: string,
): { checked: boolean; disabled: boolean } {
  const root = container.querySelector(`[data-testid="${testId}"]`);
  const input =
    root instanceof HTMLInputElement ? root : root?.querySelector('input[type="checkbox"], input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`missing switch ${testId}`);
  }
  return { checked: input.checked, disabled: input.disabled };
}

function makeConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    media: { maxPasteBytes: 1_000_000, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1_000_000,
    },
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
            <SettingsProvider value={{ hostClient: undefined } as unknown as SettingsContextValue}>
              <ProviderSettings {...props} />
            </SettingsProvider>
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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Radix DropdownMenu.Trigger opens on pointerdown, not a bare click. */
function openMenu(trigger: Element | null): void {
  act(() => {
    trigger?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    trigger?.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    trigger?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function byTestId<T extends Element = HTMLElement>(scope: ParentNode, testId: string): T | null {
  return scope.querySelector<T>(`[data-testid="${testId}"]`);
}

/** A configured provider's connection is folded under its models. */
function openConnection(container: HTMLElement): void {
  act(() => {
    byTestId<HTMLButtonElement>(container, 'provider-connection-toggle')?.click();
  });
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

  function mount(props: ProviderSettingsProps): HTMLDivElement {
    const rendered = renderProviderSettings(props);
    instances.push(rendered);
    return rendered.container;
  }

  it('shows the rail and the first provider in the detail pane', () => {
    const container = mount(makeProps());
    expect(byTestId(container, 'provider-settings')).not.toBeNull();
    expect(byTestId(container, 'provider-search-input')).not.toBeNull();
    expect(byTestId(container, 'provider-add-block')).not.toBeNull();
    expect(byTestId(container, 'provider-row-openai')?.getAttribute('aria-current')).toBe('true');
    expect(byTestId(container, 'provider-row-custom-local')).not.toBeNull();
    // Models are the body; a configured connection is only a line in the header
    // (key state + address) with a button that opens its panel.
    expect(byTestId(container, 'provider-models-openai')).not.toBeNull();
    expect(byTestId(container, 'provider-connection-section')).toBeNull();
    expect(byTestId(container, 'provider-key-state')?.textContent).toBe('Key saved');
    expect(container.querySelector('.pdetail-host')?.textContent).toBe('api.openai.com/v1');
    const toggle = byTestId(container, 'provider-connection-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    openConnection(container);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    // The panel opens under the header, above the models.
    const panel = byTestId(container, 'provider-connection-section');
    const models = byTestId(container, 'provider-models-openai');
    expect(
      panel && models ? panel.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING : 0,
    ).toBeTruthy();
    expect(byTestId<HTMLInputElement>(container, 'provider-baseurl-input')?.value).toBe(
      'https://api.openai.com/v1',
    );
    expect(byTestId(container, 'provider-savebar')).toBeNull();
  });

  it('selects another provider from the rail', async () => {
    const container = mount(makeProps());
    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-row-custom-local')?.click();
    });
    // No saved key: the folded summary says so.
    expect(byTestId(container, 'provider-key-state')?.textContent).toBe('No key');
    expect(byTestId(container, 'provider-key-state')?.className).toContain('is-missing');
    openConnection(container);
    expect(byTestId<HTMLInputElement>(container, 'provider-name-input')?.value).toBe('Local');
    expect(byTestId(container, 'provider-row-custom-local')?.getAttribute('aria-current')).toBe(
      'true',
    );
    expect(byTestId(container, 'provider-row-custom-local')?.className).toContain('is-off');
  });

  it('lists custom providers before OAuth packages in the rail', () => {
    const container = mount({
      ...makeProps(),
      config: {
        ...makeConfig(),
        providers: [
          {
            id: 'kimi-coding',
            protocol: 'openai-compatible',
            name: 'Kimi Coding',
            source: 'subscription',
            category: 'package',
            baseUrl: 'oauth://kimi-coding',
            models: [{ id: 'kimi-k1.5' }],
          },
          ...makeConfig().providers,
        ],
      },
    });
    const custom = byTestId(container, 'provider-section-custom');
    const packages = byTestId(container, 'provider-section-package');
    expect(custom?.querySelector('[data-testid="provider-row-openai"]')).not.toBeNull();
    expect(packages?.querySelector('[data-testid="provider-row-kimi-coding"]')).not.toBeNull();
    expect(
      custom && packages
        ? custom.compareDocumentPosition(packages) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).toBeTruthy();
    // The rail falls back to the first custom provider, not the package.
    expect(byTestId(container, 'provider-row-openai')?.getAttribute('aria-current')).toBe('true');
  });

  it('shows a package without a connection form', () => {
    const container = mount({
      ...makeProps(),
      config: {
        ...makeConfig(),
        defaultProviderId: 'kimi-coding',
        providers: [
          {
            id: 'kimi-coding',
            protocol: 'openai-compatible',
            name: 'Kimi Coding',
            source: 'subscription',
            category: 'package',
            baseUrl: 'oauth://kimi-coding',
            models: [{ id: 'kimi-k1.5' }],
          },
        ],
      },
    });
    expect(byTestId(container, 'provider-connection')).toBeNull();
    expect(byTestId(container, 'provider-models-kimi-coding')).not.toBeNull();
    expect(byTestId(container, 'provider-discover-models-kimi-coding')).toBeNull();
  });

  it('filters the rail by search query', () => {
    const container = mount(makeProps());
    act(() => {
      setInputValue(byTestId<HTMLInputElement>(container, 'provider-search-input'), 'local');
    });
    expect(byTestId(container, 'provider-row-openai')).toBeNull();
    expect(byTestId(container, 'provider-row-custom-local')).not.toBeNull();
  });

  it('reveals the saved key without counting it as an edit', async () => {
    const onLoadSecret = vi.fn(async () => 'sk-saved-secret');
    const container = mount({ ...makeProps(), onLoadSecret });
    openConnection(container);
    const input = byTestId<HTMLInputElement>(container, 'provider-apikey-input');
    expect(input?.value).toBe('');
    expect(input?.type).toBe('password');

    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-toggle-key-visibility')?.click();
    });

    expect(onLoadSecret).toHaveBeenCalledWith('openai');
    expect(input?.value).toBe('sk-saved-secret');
    expect(input?.type).toBe('text');
    expect(byTestId(container, 'provider-savebar')).toBeNull();

    // Hiding and showing again reuses the filled value instead of re-reading.
    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-toggle-key-visibility')?.click();
    });
    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-toggle-key-visibility')?.click();
    });
    expect(onLoadSecret).toHaveBeenCalledTimes(1);
  });

  it('does not paste a multi-key secret into the single-line key input', async () => {
    const props = { ...makeProps(), onLoadSecret: vi.fn(async () => 'sk-one\nsk-two') };
    const container = mount(props);
    openConnection(container);
    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-toggle-key-visibility')?.click();
    });
    expect(byTestId<HTMLInputElement>(container, 'provider-apikey-input')?.value).toBe('');
    expect(props.onError).toHaveBeenCalled();
  });

  it('shows a save bar only while the connection differs, and reverts it', () => {
    const container = mount(makeProps());
    openConnection(container);
    const input = byTestId<HTMLInputElement>(container, 'provider-baseurl-input');
    act(() => {
      setInputValue(input, 'https://new.example.com/v1');
    });
    expect(byTestId(container, 'provider-savebar')).not.toBeNull();
    // Unsaved edits cannot be folded away.
    expect(byTestId<HTMLButtonElement>(container, 'provider-connection-toggle')?.disabled).toBe(true);

    act(() => {
      setInputValue(input, 'https://api.openai.com/v1');
    });
    expect(byTestId(container, 'provider-savebar')).toBeNull();

    act(() => {
      setInputValue(input, 'https://new.example.com/v1');
    });
    act(() => {
      byTestId<HTMLButtonElement>(container, 'provider-cancel-btn')?.click();
    });
    expect(byTestId<HTMLInputElement>(container, 'provider-baseurl-input')?.value).toBe(
      'https://api.openai.com/v1',
    );
    expect(byTestId(container, 'provider-savebar')).toBeNull();
  });

  it('asks before leaving unsaved connection edits', async () => {
    const container = mount(makeProps());
    openConnection(container);
    act(() => {
      setInputValue(byTestId<HTMLInputElement>(container, 'provider-name-input'), 'Renamed');
    });
    act(() => {
      byTestId<HTMLButtonElement>(container, 'provider-row-custom-local')?.click();
    });
    await flush();
    expect(byTestId(document.body, 'confirm-dialog')).not.toBeNull();

    await act(async () => {
      byTestId<HTMLButtonElement>(document.body, 'confirm-dialog-cancel')?.click();
    });
    await flush();
    expect(byTestId<HTMLInputElement>(container, 'provider-name-input')?.value).toBe('Renamed');

    act(() => {
      byTestId<HTMLButtonElement>(container, 'provider-row-custom-local')?.click();
    });
    await flush();
    await act(async () => {
      byTestId<HTMLButtonElement>(document.body, 'confirm-dialog-confirm')?.click();
    });
    await flush();
    openConnection(container);
    expect(byTestId<HTMLInputElement>(container, 'provider-name-input')?.value).toBe('Local');
  });

  it('saves a new base url without rolling back models edited meanwhile', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const props = makeProps(onSave);
    const rendered = renderProviderSettings(props);
    instances.push(rendered);
    const { container, root } = rendered;
    openConnection(container);
    act(() => {
      setInputValue(byTestId<HTMLInputElement>(container, 'provider-baseurl-input'), 'https://new.example.com/v1');
    });

    // A model edit persisted elsewhere on the page after the draft was opened.
    const nextConfig = makeConfig();
    const openaiNow = nextConfig.providers[0];
    if (!openaiNow) throw new Error('fixture');
    openaiNow.models = [...openaiNow.models, { id: 'gpt-4.1-mini' }];
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={{ hostClient: undefined } as unknown as SettingsContextValue}>
              <ProviderSettings {...props} config={nextConfig} />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-save-btn')?.click();
    });
    await flush();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const openai = saved.providers.find((p: ModelProviderConfig) => p.id === 'openai');
    expect(openai?.baseUrl).toBe('https://new.example.com/v1');
    expect(openai?.models.map((model) => model.id)).toEqual(['gpt-4.1', 'gpt-4.1-mini']);
    expect(byTestId(container, 'provider-savebar')).toBeNull();
  });

  it('tests the connection with the typed key and stores it on save', async () => {
    const onDiscoverModels = vi.fn(async () => ({
      providerId: 'openai',
      protocol: 'openai-compatible' as const,
      models: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }],
    }));
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const props = { ...makeProps(onSave), onDiscoverModels };
    const container = mount(props);
    openConnection(container);
    act(() => {
      setInputValue(byTestId<HTMLInputElement>(container, 'provider-apikey-input'), '123456');
    });
    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-test-connection')?.click();
    });
    await flush();
    expect(onDiscoverModels).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai' }), {
      apiKey: '123456',
    });
    expect(props.onStoreSecret).not.toHaveBeenCalled();

    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-save-btn')?.click();
    });
    await flush();
    expect(props.onStoreSecret).toHaveBeenCalledWith('openai', '123456');
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const provider = saved.providers.find((item) => item.id === 'openai');
    expect(provider?.apiKeyRef).toBe('keychain-openai');
    expect(provider?.apiKeyEnv).toBeUndefined();
  });

  it('marks the rail item red and keeps delete reachable after a failed test', async () => {
    const onDiscoverModels = vi.fn(async () => {
      throw new Error('Model discovery failed (404 Not Found: <!DOCTYPE html>)');
    });
    const container = mount({ ...makeProps(), onDiscoverModels });
    openConnection(container);
    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-test-connection')?.click();
    });
    await flush();
    expect(
      byTestId(container, 'provider-row-openai')?.querySelector('.prail-dot--err'),
    ).not.toBeNull();
    const pill = container.querySelector('.provider-status-pill--err');
    expect(pill?.getAttribute('title')).toContain('Model discovery failed');

    openMenu(byTestId(container, 'provider-detail-more'));
    expect(byTestId(document.body, 'provider-delete-btn')).not.toBeNull();
  });

  it('deletes the provider after confirmation and selects the next one', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const container = mount(makeProps(onSave));
    openMenu(byTestId(container, 'provider-detail-more'));
    await act(async () => {
      byTestId<HTMLElement>(document.body, 'provider-delete-btn')?.click();
    });
    await flush();
    await act(async () => {
      byTestId<HTMLButtonElement>(document.body, 'confirm-dialog-confirm')?.click();
    });
    await flush();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    expect(saved.providers.map((provider) => provider.id)).toEqual(['custom-local']);
  });

  it('toggles the provider from the detail header and saves at once', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const container = mount(makeProps(onSave));
    const toggle = byTestId<HTMLElement>(container, 'provider-enable-switch');
    const input =
      toggle instanceof HTMLInputElement ? toggle : toggle?.querySelector<HTMLInputElement>('input');
    await act(async () => {
      input?.click();
    });
    await flush();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const openai = saved.providers.find((p: ModelProviderConfig) => p.id === 'openai');
    expect(openai?.enabled).toBe(false);
    expect(openai?.models[0]?.enabled).toBeUndefined();
  });

  it('shows models as off and locked when the provider is disabled', () => {
    const container = mount({
      ...makeProps(),
      config: {
        ...makeConfig(),
        providers: [
          {
            id: 'xgrok',
            protocol: 'openai-compatible',
            name: 'xgrok',
            baseUrl: 'https://xgrok.planora.chat',
            enabled: false,
            models: [{ id: 'grok-imagine-image-lite', capabilities: ['image-generation'] }],
          },
        ],
      },
    });
    expect(byTestId(container, 'provider-row-xgrok')?.className).toContain('is-off');
    expect(container.querySelector('.pmodel-item')?.className).toContain('is-off');
    const modelSwitch = readSwitch(container, 'provider-model-toggle-grok-imagine-image-lite');
    expect(modelSwitch.checked).toBe(false);
    expect(modelSwitch.disabled).toBe(true);
  });

  it('opens the add dialog with the custom endpoints first and drafts a new provider', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const container = mount(makeProps(onSave));
    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-add-block')?.click();
    });
    await flush();
    const picker = byTestId(document.body, 'provider-preset-picker');
    const firstPreset = picker?.querySelector('[data-testid^="provider-preset-"]');
    expect(firstPreset?.getAttribute('data-testid')).toBe('provider-preset-custom-openai');
    expect(byTestId(document.body, 'provider-preset-deepseek')).not.toBeNull();

    // 'openai' is configured already, so the preset yields a second instance.
    await act(async () => {
      byTestId<HTMLButtonElement>(document.body, 'provider-preset-openai')?.click();
    });
    await flush();
    expect(byTestId(container, 'provider-row-pending')).not.toBeNull();
    expect(byTestId<HTMLInputElement>(container, 'provider-name-input')?.value).toBe('OpenAI 2');
    expect(byTestId(container, 'provider-models-openai-2')).toBeNull();

    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-save-btn')?.click();
    });
    await flush();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const second = saved.providers.find((provider) => provider.id === 'openai-2');
    expect(second?.name).toBe('OpenAI 2');
    expect(second?.protocol).toBe('openai-compatible');
  });

  it('runs a model test from the row menu and shows the result inline', async () => {
    const onError = vi.fn();
    const props = {
      ...makeProps(),
      onError,
      onTestModel: vi.fn(async () => {
        throw new Error('401 Unauthorized');
      }),
    };
    const container = mount(props);
    openMenu(byTestId(container, 'provider-model-more-gpt-4.1'));
    await act(async () => {
      byTestId<HTMLElement>(document.body, 'provider-model-test-gpt-4.1')?.click();
    });
    await flush();
    expect(onError).toHaveBeenCalledWith('Model "gpt-4.1" test failed: 401 Unauthorized');
    const status = byTestId(container, 'provider-model-test-status-gpt-4.1');
    expect(status?.className).toContain('pmodel-test--error');
    expect(status?.textContent).toBe('Failed');
    expect(status?.getAttribute('title')).toBe('401 Unauthorized');
  });

  it('edits model parameters inline from the row and persists on save', async () => {
    const onSave = vi.fn<ProviderSettingsProps['onSave']>(async () => true);
    const container = mount(makeProps(onSave));
    act(() => {
      byTestId<HTMLElement>(container, 'provider-model-row')?.click();
    });
    await flush();
    const contextInput = byTestId<HTMLInputElement>(container, 'model-edit-context');
    expect(contextInput).not.toBeNull();
    act(() => {
      setInputValue(contextInput, '256000');
    });
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'model-edit-save')?.click();
    });
    await flush();
    const saved = onSave.mock.calls[0]?.[0] as PiwinConfig;
    const gpt = saved.providers
      .find((p: ModelProviderConfig) => p.id === 'openai')
      ?.models.find((model) => model.id === 'gpt-4.1');
    expect(gpt).toEqual(expect.objectContaining({ contextWindow: 256000 }));
  });

  it('marks model rows as expandable and opens the editor from the keyboard', async () => {
    const container = mount(makeProps());
    const row = byTestId<HTMLElement>(container, 'provider-model-row');
    expect(row?.getAttribute('role')).toBe('button');
    expect(row?.getAttribute('aria-expanded')).toBe('false');
    expect(row?.querySelector('.pmodel-chevron')).not.toBeNull();
    // Configured parameters show on the folded row.
    expect([...(row?.querySelectorAll('.pmodel-param') ?? [])].map((el) => el.textContent)).toEqual([
      'ctx 128K',
      'out 33K',
    ]);

    await act(async () => {
      row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(row?.getAttribute('aria-expanded')).toBe('true');
    expect(byTestId(container, 'model-edit-context')).not.toBeNull();
  });

  it('fetches models from the models section', async () => {
    const onDiscoverModels = vi.fn(async () => ({
      providerId: 'openai',
      protocol: 'openai-compatible' as const,
      models: [
        { id: 'gpt-4.1', label: 'GPT-4.1' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      ],
    }));
    const container = mount({ ...makeProps(), onDiscoverModels });
    await act(async () => {
      byTestId<HTMLButtonElement>(container, 'provider-discover-models-openai')?.click();
    });
    await flush();
    expect(onDiscoverModels).toHaveBeenCalled();
    expect(byTestId(document.body, 'discover-models-search')).not.toBeNull();
  });
});
