// @vitest-environment happy-dom
/**
 * ImageGenerationSettings coverage — form-first add flow, compact model list,
 * set-default / remove, and capability-tagged image-generation routes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWebConfig, type PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { ImageGenerationSettings } from './ImageGenerationSettings';
import { VideoGenerationSettings } from './VideoGenerationSettings';
import { SettingsProvider, type SettingsContextValue } from './settings/settings-context';
import { ImageGenerationPage } from './settings/pages/image-generation-page';
import { webToDraft } from './settings/web-draft';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noopRequest = vi.fn(async () => ({
  type: 'response' as const,
  command: 'test',
  success: true as const,
  data: { config: {} },
}));

function makeConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [
      {
        id: 'zhipu',
        protocol: 'openai-compatible',
        name: 'Zhipu (GLM)',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKeyRef: 'zhipu-keychain-ref',
        models: [
          {
            id: 'glm-image',
            label: 'GLM-图像生成',
            capabilities: ['image-generation'],
            routes: { 'image-generation': { path: '/images/generations', timeoutMs: 300000 } },
          },
        ],
      },
    ],
    media: { maxPasteBytes: 1_000_000, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1_000_000,
    },
  };
}

function createContextValue(
  config: PiwinConfig,
  saveConfig: (next: PiwinConfig) => Promise<boolean>,
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
    requestTheme: noopRequest,
    requestPet: noopRequest,
    requestAutomation: noopRequest,
    requestSubAgent: undefined,
    activeTheme: PIWIN_APPEARANCE_DARK,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    searchModelCatalog: vi.fn(async () => ({ entries: [], catalogVersion: 'test' })),
    searchImageModelCatalog: vi.fn(async () => ({ entries: [], catalogVersion: 'test' })),
    storeProviderSecret: vi.fn(),
    loadProviderSecret: vi.fn(),
  };
}

function renderSettings(
  config: PiwinConfig,
  saveConfig: (next: PiwinConfig) => Promise<boolean>,
  content: ReactElement = <ImageGenerationSettings />,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={createContextValue(config, saveConfig)}>
              {content}
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  return { container, root };
}

/** Set a controlled input value the way React tracks it (native setter + input event). */
function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (!input) {
    return;
  }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ImageGenerationSettings', () => {
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

  it('renders the real provider channel select, image model row, and request path', async () => {
    const config = makeConfig();
    ({ root, container } = renderSettings(
      config,
      vi.fn(async () => true),
    ));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Uses real config.providers (same channels as Models), not a fake vendor list.
    const select = container!.querySelector<HTMLSelectElement>(
      '[data-testid="image-gen-provider-select-control"]',
    );
    expect(select).not.toBeNull();
    expect(select?.value).toBe('zhipu');
    expect(select?.textContent ?? '').toContain('Zhipu');

    const row = container!.querySelector('[data-testid="image-model-row"]');
    expect(row).not.toBeNull();
    expect(row?.textContent ?? '').toContain('glm-image');
    expect(row?.textContent ?? '').toContain('/images/generations');

    expect(container!.querySelector('[data-testid="image-gen-baseurl"]')?.textContent).toContain(
      'https://open.bigmodel.cn',
    );
    const keyStatus =
      container!.querySelector('[data-testid="image-gen-apikey-status"]')?.textContent ?? '';
    expect(keyStatus).toContain('••••••••');
  });

  it('adds an image model with capabilities and an image-generation route', async () => {
    const config = makeConfig();
    const saved: PiwinConfig[] = [];
    const saveConfig = vi.fn(async (next: PiwinConfig) => {
      saved.push(next);
      return true;
    });
    ({ root, container } = renderSettings(config, saveConfig));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const submit = container!.querySelector<HTMLButtonElement>(
      '[data-testid="image-add-model-submit"]',
    );
    expect(submit).not.toBeNull();

    act(() => {
      // Missing leading slash is normalized on save.
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="image-model-suggest-input"]'),
        'cogview-3',
      );
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="image-add-model-path"]'),
        'images/generations',
      );
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="image-add-model-timeout"]'),
        '120',
      );
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="image-add-model-label"]'),
        'CogView 3',
      );
    });
    act(() => {
      submit?.click();
    });

    expect(saved.length).toBeGreaterThan(0);
    const last = saved[saved.length - 1];
    const added = last?.providers[0]?.models.find((model) => model.id === 'cogview-3');
    expect(added).toBeDefined();
    expect(added?.capabilities).toEqual(['image-generation']);
    expect(added?.label).toBe('CogView 3');
    expect(added?.routes?.['image-generation']?.path).toBe('/images/generations');
    expect(added?.routes?.['image-generation']?.timeoutMs).toBe(120000);
  });

  it('sets the default image model when set-default is clicked', async () => {
    const config = makeConfig();
    const saved: PiwinConfig[] = [];
    const saveConfig = vi.fn(async (next: PiwinConfig) => {
      saved.push(next);
      return true;
    });
    ({ root, container } = renderSettings(config, saveConfig));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const button = container!.querySelector<HTMLButtonElement>(
      '[data-testid="image-model-set-default"]',
    );
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });

    expect(saved.length).toBeGreaterThan(0);
    const last = saved[saved.length - 1];
    expect(last?.imageGeneration?.defaultModel).toEqual({
      protocol: 'openai-compatible',
      providerId: 'zhipu',
      modelId: 'glm-image',
    });
  });

  it('removes an image model from the provider', async () => {
    const config = makeConfig();
    const saved: PiwinConfig[] = [];
    const saveConfig = vi.fn(async (next: PiwinConfig) => {
      saved.push(next);
      return true;
    });
    ({ root, container } = renderSettings(config, saveConfig));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const removeButton = container!.querySelector<HTMLButtonElement>(
      '[data-testid="image-model-remove"]',
    );
    expect(removeButton).not.toBeNull();
    act(() => {
      removeButton?.click();
    });

    expect(saved.length).toBeGreaterThan(0);
    const last = saved[saved.length - 1];
    expect(last?.providers[0]?.models).toHaveLength(0);
  });

  it('switches between image and video configuration tabs', async () => {
    const config = makeConfig();
    ({ root, container } = renderSettings(
      config,
      vi.fn(async () => true),
      <ImageGenerationPage />,
    ));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container!.querySelector('[data-testid="media-generation-tab-image"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="media-generation-tab-video"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="media-generation-panel-image"]')).not.toBeNull();

    await act(async () => {
      const videoTab = container!.querySelector<HTMLButtonElement>(
        '[data-testid="media-generation-tab-video"]',
      );
      videoTab?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: false }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector('[data-testid="video-generation-settings"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="image-generation-settings"]')).toBeNull();
  });

  it('adds a video model with an async API style and polling route', async () => {
    const config = makeConfig();
    const saved: PiwinConfig[] = [];
    const saveConfig = vi.fn(async (next: PiwinConfig) => {
      saved.push(next);
      return true;
    });
    ({ root, container } = renderSettings(config, saveConfig, <VideoGenerationSettings />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="video-model-id"]'),
        'gen4.5',
      );
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="video-add-model-path"]'),
        'v1/text_to_video',
      );
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="video-add-model-timeout"]'),
        '600',
      );
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="video-add-poll-interval"]'),
        '5',
      );
      const style = container!.querySelector<HTMLSelectElement>('[data-testid="video-api-style"]');
      if (style) {
        style.value = 'runway-tasks';
        style.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    act(() => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="video-add-model-submit"]')
        ?.click();
    });

    const added = saved.at(-1)?.providers[0]?.models.find((model) => model.id === 'gen4.5');
    expect(added?.capabilities).toContain('video-generation');
    expect(added?.routes?.['video-generation']).toMatchObject({
      apiStyle: 'runway-tasks',
      path: '/v1/text_to_video',
      timeoutMs: 600_000,
      pollIntervalMs: 5_000,
    });
  });

  it('ImageModelSuggest dropdown shows matched models from Pi catalog', async () => {
    const config = makeConfig();
    const saveConfig = vi.fn(async () => true);
    const discoverProviderModels = vi.fn(async () => ({
      providerId: 'zhipu',
      protocol: 'openai-compatible' as const,
      models: [{ id: 'gpt-image-1', label: 'GPT Image 1' }],
    }));
    const searchImageModelCatalog = vi.fn(async () => ({
      entries: [
        {
          catalogProviderId: 'openrouter',
          modelId: 'openai/gpt-image-1',
          name: 'GPT Image 1',
          input: ['text', 'image'] as const,
          output: ['image'] as const,
        },
        {
          catalogProviderId: 'openrouter',
          modelId: 'google/gemini-3-pro-image',
          name: 'Gemini 3 Pro Image',
          input: ['image', 'text'] as const,
          output: ['image', 'text'] as const,
        },
      ],
      catalogVersion: 'test',
    }));

    const containerEl = document.createElement('div');
    document.body.appendChild(containerEl);
    const reactRoot = createRoot(containerEl);
    root = reactRoot;
    container = containerEl;

    const base = createContextValue(config, saveConfig);
    act(() => {
      reactRoot.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
              <SettingsProvider
                value={{ ...base, discoverProviderModels, searchImageModelCatalog }}
              >
                <ImageGenerationSettings />
              </SettingsProvider>
            </DesktopLocaleProvider>
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Focus the model ID input to open the suggestion dropdown.
    const input = containerEl.querySelector<HTMLInputElement>(
      '[data-testid="image-model-suggest-input"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      input?.focus();
      // Sequential async calls (catalog then discovery) need multiple ticks.
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // The dropdown should appear with matched models.
    const dropdown = containerEl.querySelector('[data-testid="image-model-suggest-dropdown"]');
    expect(dropdown).not.toBeNull();

    // gpt-image-1 should be matched (discovered), gemini should be unmatched.
    const list = containerEl.querySelector('[data-testid="image-model-suggest-list"]');
    expect(list?.textContent ?? '').toContain('gpt-image-1');

    // "Show all" button should be present for the unmatched model.
    const showAllBtn = containerEl.querySelector<HTMLButtonElement>(
      '[data-testid="image-model-suggest-show-all"]',
    );
    expect(showAllBtn).not.toBeNull();
  });
});
