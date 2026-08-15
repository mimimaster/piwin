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
import { ModelsPage } from './settings/pages/models-page';
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
  contextOverrides: Partial<SettingsContextValue> = {},
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider
              value={{ ...createContextValue(config, saveConfig), ...contextOverrides }}
            >
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
    await act(async () => {
      submit?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(saved.length).toBeGreaterThan(0);
    const last = saved[saved.length - 1];
    const added = last?.providers[0]?.models.find((model) => model.id === 'cogview-3');
    expect(added).toBeDefined();
    expect(added?.capabilities).toEqual(['image-generation']);
    expect(added?.label).toBe('CogView 3');
    expect(added?.routes?.['image-generation']?.path).toBe('/images/generations');
    expect(added?.routes?.['image-generation']?.timeoutMs).toBe(120000);
    expect(last?.imageGeneration?.defaultModel).toEqual({
      protocol: 'openai-compatible',
      providerId: 'zhipu',
      modelId: 'cogview-3',
    });
  });

  it('adds an image model with a Gemini-native apiStyle and path', async () => {
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

    const styleSelect = container!.querySelector<HTMLSelectElement>(
      '[data-testid="image-add-model-style"]',
    );
    expect(styleSelect).not.toBeNull();

    act(() => {
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="image-model-suggest-input"]'),
        'gemini-3.1-flash-image',
      );
      // Switching the wire format refreshes the default path.
      styleSelect!.value = 'gemini';
      styleSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="image-add-model-path"]'),
        '/v1beta/models/gemini-3.1-flash-image:generateContent',
      );
      setInputValue(
        container!.querySelector<HTMLInputElement>('[data-testid="image-add-model-timeout"]'),
        '180',
      );
    });
    await act(async () => {
      submit?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(saved.length).toBeGreaterThan(0);
    const added = saved[saved.length - 1]?.providers[0]?.models.find(
      (model) => model.id === 'gemini-3.1-flash-image',
    );
    expect(added).toBeDefined();
    expect(added?.routes?.['image-generation']).toEqual({
      apiStyle: 'gemini',
      path: '/v1beta/models/gemini-3.1-flash-image:generateContent',
      timeoutMs: 180000,
    });
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

  it('removes image-generation capability and route while preserving the model on the provider', async () => {
    const config = makeConfig();
    config.imageGeneration = {
      defaultModel: {
        protocol: 'openai-compatible',
        providerId: 'zhipu',
        modelId: 'glm-image',
      },
    };
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
    expect(last?.providers[0]?.models).toHaveLength(1);
    expect(last?.providers[0]?.models[0]).toMatchObject({
      id: 'glm-image',
      label: 'GLM-图像生成',
    });
    expect(last?.providers[0]?.models[0]?.capabilities).toBeUndefined();
    expect(last?.providers[0]?.models[0]?.routes).toBeUndefined();
    expect(last?.imageGeneration).toBeUndefined();
  });

  it('preserves other capabilities and routes when image-generation is removed', async () => {
    const config = makeConfig();
    config.providers[0]!.models[0] = {
      id: 'gpt-4o',
      label: 'GPT-4o Multi',
      capabilities: ['native-web-search', 'image-generation', 'video-generation'],
      routes: {
        'image-generation': { path: '/images/generations', timeoutMs: 300000 },
        'video-generation': { path: '/video/generations' },
      },
    };
    config.imageGeneration = {
      defaultModel: {
        protocol: 'openai-compatible',
        providerId: 'zhipu',
        modelId: 'gpt-4o',
      },
    };
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
    expect(last?.providers[0]?.models).toHaveLength(1);
    expect(last?.providers[0]?.models[0]).toMatchObject({
      id: 'gpt-4o',
      label: 'GPT-4o Multi',
      capabilities: ['native-web-search', 'video-generation'],
      routes: {
        'video-generation': { path: '/video/generations' },
      },
    });
    expect(last?.providers[0]?.models[0]?.capabilities).not.toContain('image-generation');
    expect(last?.providers[0]?.models[0]?.routes?.['image-generation']).toBeUndefined();
    expect(last?.imageGeneration).toBeUndefined();
  });

  it('tests the configured model through the real image-test callback', async () => {
    const config = makeConfig();
    const setInfo = vi.fn();
    const testImageGenerationModel = vi.fn(async () => ({
      providerId: 'zhipu',
      modelId: 'glm-image',
      durationMs: 321,
      imageCount: 1,
      outputs: [{ mimeType: 'image/jpeg', byteSize: 4096 }],
    }));
    ({ root, container } = renderSettings(
      config,
      vi.fn(async () => true),
      <ImageGenerationSettings />,
      { setInfo, testImageGenerationModel },
    ));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="image-model-test"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(testImageGenerationModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'zhipu' }),
      'glm-image',
    );
    expect(setInfo).toHaveBeenCalledWith(expect.stringContaining('jpeg'), 'success');
  });

  it('switches between image and video configuration tabs', async () => {
    const config = makeConfig();
    ({ root, container } = renderSettings(
      config,
      vi.fn(async () => true),
      <ModelsPage />,
    ));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const modelsPage = container!.querySelector('[data-testid="settings-models"]');
    expect(modelsPage?.children[0]?.getAttribute('data-testid')).toBe('settings-model-management');

    // ModelsPage defaults to the channels/chat destination; all capabilities share one nav.
    expect(container!.querySelector('[data-testid="model-workspace-overview"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="model-config-tab-image"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="model-config-tab-video"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="model-config-tab-speech"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="settings-speech-defaults"]')).toBeNull();

    await act(async () => {
      const imageTab = container!.querySelector<HTMLButtonElement>(
        '[data-testid="model-config-tab-image"]',
      );
      imageTab?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: false }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector('[data-testid="model-config-panel-image"]')).not.toBeNull();

    await act(async () => {
      const videoTab = container!.querySelector<HTMLButtonElement>(
        '[data-testid="model-config-tab-video"]',
      );
      videoTab?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: false }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector('[data-testid="video-generation-settings"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="image-generation-settings"]')).toBeNull();

    await act(async () => {
      const speechTab = container!.querySelector<HTMLButtonElement>(
        '[data-testid="model-config-tab-speech"]',
      );
      speechTab?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: false }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector('[data-testid="model-config-panel-speech"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="settings-speech-defaults"]')).not.toBeNull();
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

  it('ImageModelSuggest dropdown strictly shows image-capable models from provider.models by default', async () => {
    const config: PiwinConfig = {
      ...makeConfig(),
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
            },
            {
              id: 'glm-video',
              label: 'GLM-视频生成',
              capabilities: ['video-generation'],
            },
            {
              id: 'glm-4',
              label: 'GLM-4 对话',
              capabilities: ['chat'],
            },
            {
              id: 'glm-disabled-image',
              label: 'GLM 禁用生图',
              capabilities: ['image-generation'],
              enabled: false,
            },
          ],
        },
      ],
    };
    const saveConfig = vi.fn(async () => true);

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
              <SettingsProvider value={base}>
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
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // The dropdown should appear.
    const dropdown = containerEl.querySelector('[data-testid="image-model-suggest-dropdown"]');
    expect(dropdown).not.toBeNull();

    // Default view: ONLY glm-image should be present.
    const list = containerEl.querySelector('[data-testid="image-model-suggest-list"]');
    const text = list?.textContent ?? '';
    expect(text).toContain('glm-image');
    expect(text).not.toContain('glm-video');
    expect(text).not.toContain('glm-4');
    expect(text).not.toContain('glm-disabled-image');

    // "View all channel models (3)" button should be present.
    const showAllBtn = containerEl.querySelector<HTMLButtonElement>(
      '[data-testid="image-model-suggest-show-all"]',
    );
    expect(showAllBtn).not.toBeNull();
    expect(showAllBtn?.textContent ?? '').toContain('View all channel models (3)');

    // Click "View all" to expand all enabled models of this provider.
    await act(async () => {
      showAllBtn?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const expandedText = list?.textContent ?? '';
    expect(expandedText).toContain('glm-image');
    expect(expandedText).toContain('glm-video');
    expect(expandedText).toContain('glm-4');
    expect(expandedText).not.toContain('glm-disabled-image');
  });

  it('allows clicking an option from the dropdown to select model ID and auto-fill metadata', async () => {
    const config: PiwinConfig = {
      ...makeConfig(),
      providers: [
        {
          id: 'xgrok',
          protocol: 'openai-compatible',
          name: 'xGrok',
          baseUrl: 'https://xgrok.planora.chat',
          models: [
            {
              id: 'grok-imagine-image-quality-lite',
              label: 'Grok Imagine Quality Lite',
              capabilities: ['image-generation'],
              routes: {
                'image-generation': {
                  path: '/v1/images/generations',
                  timeoutMs: 120000,
                },
              },
            },
          ],
        },
      ],
    };
    const saveConfig = vi.fn(async () => true);

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
            <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
              <SettingsProvider value={base}>
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

    const input = containerEl.querySelector<HTMLInputElement>(
      '[data-testid="image-model-suggest-input"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      input?.focus();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const optionBtn = containerEl.querySelector<HTMLButtonElement>(
      '.image-model-suggest-option',
    );
    expect(optionBtn).not.toBeNull();
    expect(optionBtn?.textContent ?? '').toContain('grok-imagine-image-quality-lite');

    // Click option
    await act(async () => {
      optionBtn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(input?.value).toBe('grok-imagine-image-quality-lite');

    // Check prefilled route path and timeout
    const pathInput = containerEl.querySelector<HTMLInputElement>(
      '[data-testid="image-add-model-path"]',
    );
    expect(pathInput?.value).toBe('/v1/images/generations');

    const timeoutInput = containerEl.querySelector<HTMLInputElement>(
      '[data-testid="image-add-model-timeout"]',
    );
    expect(timeoutInput?.value).toBe('120');
  });
});
