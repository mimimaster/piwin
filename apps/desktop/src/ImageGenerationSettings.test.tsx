// @vitest-environment happy-dom
/**
 * ImageGenerationSettings coverage — renders providers from config, lists
 * image-generation models (capability-filtered), and auto-saves edits into
 * config.providers[].models[].routes['image-generation'].
 *
 * Uses the same happy-dom + createRoot + act() pattern as SkillsPanel.test.tsx
 * and the settings-shell.test.tsx SettingsProvider stub.
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
    artifact: { maxBytes: 1_000_000, htmlUiModeDefault: false },
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
    saveWeb: vi.fn(async () => undefined),
    preferences: {
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
      toolDensity: 'comfortable',
      workDetailsExpanded: 'auto',
      artifactPreviewEnabled: false,
      artifactCodeFirst: false,
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
    requestPrompts: noopRequest,
    requestTheme: noopRequest,
    requestPet: noopRequest,
    requestAutomation: noopRequest,
    requestSubAgent: undefined,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    storeProviderSecret: vi.fn(),
    loadProviderSecret: vi.fn(),
  };
}

function renderSettings(
  config: PiwinConfig,
  saveConfig: (next: PiwinConfig) => Promise<boolean>,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
          <SettingsProvider value={createContextValue(config, saveConfig)}>
            <ImageGenerationSettings />
          </SettingsProvider>
        </DesktopLocaleProvider>
      </PiwinUiProvider> as ReactElement,
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

  it('renders the provider dropdown, image model row, and request path', async () => {
    const config = makeConfig();
    ({ root, container } = renderSettings(config, vi.fn(async () => true)));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const select = container!.querySelector<HTMLSelectElement>(
      '[data-testid="image-gen-provider-select"] select',
    );
    expect(select).not.toBeNull();
    expect(select?.value).toBe('zhipu');

    const row = container!.querySelector('[data-testid="image-model-row"]');
    expect(row).not.toBeNull();
    expect(row?.textContent ?? '').toContain('glm-image');
    expect(row?.textContent ?? '').toContain('/images/generations');

    expect(container!.querySelector('[data-testid="image-gen-baseurl"]')?.textContent).toContain(
      'https://open.bigmodel.cn',
    );
    const keyStatus = container!.querySelector('[data-testid="image-gen-apikey-status"]')
      ?.textContent ?? '';
    expect(keyStatus).toContain('••••••••');
  });

  it('auto-saves an edited request path into routes.image-generation', async () => {
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

    // Expand the model row to reveal the inline editor.
    const row = container!.querySelector<HTMLDivElement>('[data-testid="image-model-row"]');
    act(() => {
      row?.click();
    });

    const pathInput = container!.querySelector<HTMLInputElement>('[data-testid="image-model-path"]');
    expect(pathInput).not.toBeNull();
    expect(pathInput?.value).toBe('/images/generations');

    act(() => {
      setInputValue(pathInput, '/v1/images/generations');
    });

    // Flush the 700ms debounce and the async save.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });

    expect(saved.length).toBeGreaterThan(0);
    const last = saved[saved.length - 1];
    expect(last?.providers[0]?.models[0]?.routes?.['image-generation']?.path).toBe(
      '/v1/images/generations',
    );
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
        container!.querySelector<HTMLInputElement>('[data-testid="image-add-model-id"]'),
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

    const row = container!.querySelector<HTMLDivElement>('[data-testid="image-model-row"]');
    act(() => {
      row?.click();
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

    const row = container!.querySelector<HTMLDivElement>('[data-testid="image-model-row"]');
    act(() => {
      row?.click();
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
});
