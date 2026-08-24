// @vitest-environment happy-dom
/**
 * Image/video capability pages may write that model's generation route and
 * the default-model ref. They must not add, delete, or retag catalog rows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWebConfig, type PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { ImageGenerationSettings } from './ImageGenerationSettings';
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

  it('lists image-capable models from the provider catalog', async () => {
    ({ root, container } = renderSettings(makeConfig(), vi.fn(async () => true)));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const row = container!.querySelector('[data-testid="image-model-row"]');
    expect(row).not.toBeNull();
    expect(row?.textContent ?? '').toContain('glm-image');
    expect(row?.textContent ?? '').toContain('/images/generations');
    expect(container!.querySelector('[data-testid="image-add-model-submit"]')).toBeNull();
  });

  it('sets the default image model without rewriting provider models', async () => {
    const config = makeConfig();
    const originalModels = structuredClone(config.providers[0]?.models);
    const saved: PiwinConfig[] = [];
    const saveConfig = vi.fn(async (next: PiwinConfig) => {
      saved.push(next);
      return true;
    });
    ({ root, container } = renderSettings(config, saveConfig));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      container!.querySelector<HTMLButtonElement>('[data-testid="image-model-set-default"]')?.click();
    });

    expect(saved.length).toBeGreaterThan(0);
    const last = saved[saved.length - 1];
    expect(last?.imageGeneration?.defaultModel).toEqual({
      protocol: 'openai-compatible',
      providerId: 'zhipu',
      modelId: 'glm-image',
    });
    expect(last?.providers[0]?.models).toEqual(originalModels);
  });

  it('saves image protocol onto the existing model route', () => {
    const config = makeConfig();
    const saved: PiwinConfig[] = [];
    ({ root, container } = renderSettings(config, async (next) => {
      saved.push(next);
      return true;
    }));

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="image-model-edit-route"]')
        ?.click();
    });
    const path = container?.querySelector<HTMLInputElement>('[data-testid="model-edit-image-path"]');
    expect(path).not.toBeNull();
    act(() => {
      if (!path) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(path, '/images/custom');
      path.dispatchEvent(new Event('input', { bubbles: true }));
      path.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="image-model-save-route"]')
        ?.click();
    });

    expect(saved.at(-1)?.providers[0]?.models[0]?.routes).toEqual({
      'image-generation': {
        apiStyle: 'openai',
        path: '/images/custom',
        timeoutMs: 300_000,
      },
    });
    expect(saved.at(-1)?.providers[0]?.models).toHaveLength(1);
  });

  it('tests the configured model through the real image-test callback', async () => {
    const config = makeConfig();
    const testImageGenerationModel = vi.fn(async () => ({
      providerId: 'zhipu',
      modelId: 'glm-image',
      imageCount: 1,
      durationMs: 42,
      outputs: [{ mimeType: 'image/jpeg', byteSize: 1024 }],
    }));
    const setInfo = vi.fn();
    ({ root, container } = renderSettings(config, vi.fn(async () => true), <ImageGenerationSettings />, {
      testImageGenerationModel,
      setInfo,
    }));
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
    ({ root, container } = renderSettings(config, vi.fn(async () => true), <ModelsPage />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container!.querySelector('[data-testid="model-config-tab-image"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="model-config-tab-video"]')).not.toBeNull();

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
  });
});
