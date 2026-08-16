// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createDefaultWebConfig,
  type DiscoveredModel,
  type ModelProviderConfig,
  type PiwinConfig,
} from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from './settings/settings-context';
import { webToDraft } from './settings/web-draft';
import { VideoGenerationSettings } from './VideoGenerationSettings';
import { VideoModelSuggest } from './video-model-suggest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const provider: ModelProviderConfig = {
  id: 'video-provider',
  protocol: 'openai-compatible',
  name: 'Video Provider',
  baseUrl: 'https://video.example.test/v1',
  models: [],
};

const recognized: DiscoveredModel = {
  id: 'sora-2',
  label: 'Sora 2',
  capabilities: ['video-generation'],
  videoGenerationSuggestion: {
    reason: 'registry',
    apiStyle: 'openai-videos',
    path: '/videos',
    label: 'Sora 2',
  },
};

const suggested: DiscoveredModel = {
  id: 'kling-v2',
  videoGenerationSuggestion: { reason: 'heuristic' },
};

const veo: DiscoveredModel = {
  id: 'veo-3',
  label: 'Veo 3',
  capabilities: ['video-generation'],
  videoGenerationSuggestion: {
    reason: 'registry',
    apiStyle: 'google-veo',
    path: '/models/{model}:predictLongRunning',
    label: 'Google Veo',
  },
};

function makeConfig(models: ModelProviderConfig['models'] = []): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [{ ...provider, models }],
    media: { maxPasteBytes: 1_000_000, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1_000_000,
    },
  };
}

const noopRequest = vi.fn(async () => ({
  type: 'response' as const,
  command: 'test',
  success: true as const,
  data: { config: {} },
}));

function createContextValue(
  config: PiwinConfig,
  saveConfig: (next: PiwinConfig) => Promise<boolean>,
  discoverProviderModels: SettingsContextValue['discoverProviderModels'],
): SettingsContextValue {
  return {
    request: noopRequest,
    config,
    root: '~/.piwin',
    saving: false,
    setError: vi.fn(),
    setInfo: vi.fn(),
    saveConfig,
    webDraft: webToDraft(createDefaultWebConfig()),
    setWebDraft: vi.fn(),
    saveWeb: vi.fn(async () => true),
    preferences: {
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
      toolDensity: 'comfortable',
      workDetailsExpanded: 'auto',
      artifactPreviewEnabled: false,
      artifactCodeFirst: false,
      verboseAgentChat: true,
      conversationWidth: 'wide',
      appearanceMode: 'dark',
      lightTheme: {
        preset: 'default',
        background: '#EEEEEE',
        foreground: '#101010',
        accent: '#007ACC',
      },
      darkTheme: {
        preset: 'default',
        background: '#101010',
        foreground: '#CCCCCC',
        accent: '#007ACC',
      },
    },
    onPreferencesChange: vi.fn(),
    projectPath: null,
    projectTrusted: false,
    hostStatus: null,
    activeSessionId: null,
    onOpenSubagentSession: undefined,
    selectSection: vi.fn(),
    requestSkills: noopRequest,
    requestMcp: noopRequest,
    requestExtensions: noopRequest,
    requestPlugins: noopRequest,
    requestPrompts: noopRequest,
    requestPet: noopRequest,
    requestAutomation: noopRequest,
    requestSubAgent: undefined,
    activeTheme: PIWIN_APPEARANCE_DARK,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels,
    testProviderModel: vi.fn(),
    searchModelCatalog: vi.fn(async () => ({ entries: [], catalogVersion: 'test' })),
    searchImageModelCatalog: vi.fn(async () => ({ entries: [], catalogVersion: 'test' })),
    storeProviderSecret: vi.fn(),
    loadProviderSecret: vi.fn(),
  };
}

function renderWithProviders(content: ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            {content}
          </DesktopLocaleProvider>
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  return { container, root };
}

function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (!input) {
    return;
  }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('VideoModelSuggest', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('discovers once per provider and renders recognized models before heuristic suggestions', async () => {
    const discoverProviderModels = vi.fn(async () => ({
      models: [suggested, { id: 'video-understanding' }, recognized],
    }));
    const selected: DiscoveredModel[] = [];
    let value = '';
    ({ container, root } = renderWithProviders(
      <VideoModelSuggest
        value={value}
        provider={provider}
        discoverProviderModels={discoverProviderModels}
        onChange={(model) => {
          selected.push(model);
          value = model.id;
        }}
      />,
    ));

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="video-model-suggest-input"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      input?.focus();
      await flush();
    });
    await act(async () => {
      input?.blur();
      input?.focus();
      await flush();
    });

    expect(discoverProviderModels).toHaveBeenCalledTimes(1);
    const options = [
      ...container.querySelectorAll<HTMLElement>('[data-testid="video-model-suggest-option"]'),
    ];
    expect(options.map((option) => option.dataset.modelId)).toEqual(['sora-2', 'kling-v2']);
    expect(
      container.querySelector('[data-testid="video-model-suggest-group-recognized"]')?.textContent,
    ).toContain('Recognized');
    expect(
      container.querySelector('[data-testid="video-model-suggest-group-suggested"]')?.textContent,
    ).toContain('Suggested');
    expect(container.textContent).not.toContain('video-understanding');
    expect(container.textContent).toContain('/videos');
    expect(container.textContent).toContain('Selecting adds it to video models');
    expect(selected).toHaveLength(0);
  });

  it('returns a selected model without saving config', async () => {
    const discoverProviderModels = vi.fn(async () => ({ models: [recognized, suggested] }));
    const selected: DiscoveredModel[] = [];
    const rendered = renderWithProviders(
      <VideoModelSuggest
        value=""
        provider={provider}
        discoverProviderModels={discoverProviderModels}
        onChange={(model) => selected.push(model)}
      />,
    );
    container = rendered.container;
    root = rendered.root;
    const view = rendered.container;

    await act(async () => {
      view.querySelector<HTMLInputElement>('[data-testid="video-model-suggest-input"]')?.focus();
      await flush();
    });
    act(() => {
      view.querySelector<HTMLButtonElement>('[data-model-id="sora-2"]')?.click();
    });

    expect(selected).toEqual([recognized]);
  });

  it('still returns manually typed IDs when discovery has no matching model', () => {
    const discoverProviderModels = vi.fn(async () => ({ models: [] }));
    const selected: DiscoveredModel[] = [];
    const rendered = renderWithProviders(
      <VideoModelSuggest
        value=""
        provider={provider}
        discoverProviderModels={discoverProviderModels}
        onChange={(model) => selected.push(model)}
      />,
    );
    container = rendered.container;
    root = rendered.root;
    const view = rendered.container;

    act(() => {
      setInputValue(
        view.querySelector<HTMLInputElement>('[data-testid="video-model-suggest-input"]'),
        'custom-video',
      );
    });

    expect(selected).toEqual([{ id: 'custom-video' }]);
  });
});

describe('VideoGenerationSettings discovery wiring', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  function renderSettings(
    config: PiwinConfig,
    saveConfig: (next: PiwinConfig) => Promise<boolean>,
    models: DiscoveredModel[],
  ): { container: HTMLDivElement; root: Root } {
    const discoverProviderModels: SettingsContextValue['discoverProviderModels'] = vi.fn(
      async (selectedProvider) => ({
        providerId: selectedProvider.id,
        protocol: selectedProvider.protocol,
        models,
      }),
    );
    const rendered = renderWithProviders(
      <SettingsProvider value={createContextValue(config, saveConfig, discoverProviderModels)}>
        <VideoGenerationSettings />
      </SettingsProvider>,
    );
    container = rendered.container;
    root = rendered.root;
    return rendered;
  }

  it('fills Sora route metadata and waits for submit before saving a heuristic choice', async () => {
    const saveConfig = vi.fn(async () => true);
    renderSettings(makeConfig(), saveConfig, [recognized, suggested]);

    await act(async () => {
      container?.querySelector<HTMLInputElement>('[data-testid="video-model-id"]')?.focus();
      await flush();
    });
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-model-id="sora-2"]')?.click();
    });

    expect(
      container?.querySelector<HTMLInputElement>('[data-testid="video-model-id"]')?.value,
    ).toBe('sora-2');
    expect(
      container?.querySelector<HTMLInputElement>('[data-testid="video-add-model-label"]')?.value,
    ).toBe('Sora 2');
    expect(
      container?.querySelector<HTMLSelectElement>('[data-testid="video-api-style"]')?.value,
    ).toBe('openai-videos');
    expect(
      container?.querySelector<HTMLInputElement>('[data-testid="video-add-model-path"]')?.value,
    ).toBe('/videos');
    expect(saveConfig).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
      container?.remove();
    });
    root = undefined;
    container = undefined;
    const secondRender = renderSettings(makeConfig(), saveConfig, [recognized, suggested]);
    await act(async () => {
      secondRender.container
        .querySelector<HTMLInputElement>('[data-testid="video-model-id"]')
        ?.focus();
      await flush();
    });
    act(() => {
      secondRender.container
        .querySelector<HTMLButtonElement>('[data-model-id="kling-v2"]')
        ?.click();
    });
    expect(
      secondRender.container.querySelector<HTMLInputElement>('[data-testid="video-model-id"]')
        ?.value,
    ).toBe('kling-v2');
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('fills the Google Veo API style and long-running route', async () => {
    const saveConfig = vi.fn(async () => true);
    renderSettings(makeConfig(), saveConfig, [veo]);

    await act(async () => {
      container?.querySelector<HTMLInputElement>('[data-testid="video-model-id"]')?.focus();
      await flush();
    });
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-model-id="veo-3"]')?.click();
    });

    expect(
      container?.querySelector<HTMLInputElement>('[data-testid="video-model-id"]')?.value,
    ).toBe('veo-3');
    expect(
      container?.querySelector<HTMLInputElement>('[data-testid="video-add-model-label"]')?.value,
    ).toBe('Google Veo');
    expect(
      container?.querySelector<HTMLSelectElement>('[data-testid="video-api-style"]')?.value,
    ).toBe('google-veo');
    expect(
      container?.querySelector<HTMLInputElement>('[data-testid="video-add-model-path"]')?.value,
    ).toBe('/models/{model}:predictLongRunning');
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('preserves video set-default and remove behavior', async () => {
    const configuredModel = {
      id: 'existing-video',
      capabilities: ['video-generation'] as ['video-generation'],
      routes: { 'video-generation': { apiStyle: 'custom' as const, path: '/video/generations' } },
    };
    const config = makeConfig([configuredModel]);
    const saved: PiwinConfig[] = [];
    const saveConfig = vi.fn(async (next: PiwinConfig) => {
      saved.push(next);
      return true;
    });
    renderSettings(config, saveConfig, []);
    await act(async () => {
      await flush();
    });

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="video-model-set-default"]')
        ?.click();
    });
    expect(saved.at(-1)?.videoGeneration?.defaultModel).toEqual({
      protocol: 'openai-compatible',
      providerId: provider.id,
      modelId: 'existing-video',
    });

    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="video-model-remove"]')?.click();
    });
    expect(saved.at(-1)?.providers[0]?.models).toEqual([{ id: 'existing-video' }]);
  });

  it('saves a manually typed custom video ID with the custom API style', async () => {
    const saved: PiwinConfig[] = [];
    const saveConfig = vi.fn(async (next: PiwinConfig) => {
      saved.push(next);
      return true;
    });
    renderSettings(makeConfig([{ id: 'custom-video' }]), saveConfig, []);

    act(() => {
      setInputValue(
        container?.querySelector<HTMLInputElement>('[data-testid="video-model-id"]') ?? null,
        'custom-video',
      );
    });
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="video-add-model-submit"]')
        ?.click();
      await flush();
    });

    const added = saved.at(-1)?.providers[0]?.models.find((model) => model.id === 'custom-video');
    expect(added?.capabilities).toEqual(['video-generation']);
    expect(added?.routes?.['video-generation']).toMatchObject({
      apiStyle: 'custom',
      path: '/video/generations',
    });
  });

  it('disables submit and displays warning when video model is not configured on provider (3-tier constraint)', async () => {
    const saveConfig = vi.fn(async () => true);
    renderSettings(makeConfig([]), saveConfig, []);

    act(() => {
      setInputValue(
        container?.querySelector<HTMLInputElement>('[data-testid="video-model-id"]') ?? null,
        'unconfigured-video-xyz',
      );
    });

    const submit = container?.querySelector<HTMLButtonElement>('[data-testid="video-add-model-submit"]');
    expect(submit?.disabled).toBe(true);
    const hint = container?.querySelector('[data-testid="video-add-model-missing-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('unconfigured-video-xyz');
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
