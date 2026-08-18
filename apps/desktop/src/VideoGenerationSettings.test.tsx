// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWebConfig, type PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from './settings/settings-context';
import { webToDraft } from './settings/web-draft';
import { VideoGenerationSettings } from './VideoGenerationSettings';

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
        id: 'video-provider',
        protocol: 'openai-compatible',
        name: 'Video Provider',
        baseUrl: 'https://video.example.test/v1',
        models: [
          {
            id: 'existing-video',
            capabilities: ['video-generation'],
            routes: { 'video-generation': { apiStyle: 'custom', path: '/video/generations' } },
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

function renderSettings(
  config: PiwinConfig,
  saveConfig: (next: PiwinConfig) => Promise<boolean>,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const value = {
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
    selectSection: vi.fn(),
    requestSkills: noopRequest,
    requestMcp: noopRequest,
    requestExtensions: noopRequest,
    requestPlugins: noopRequest,
    requestPrompts: noopRequest,
    requestPet: noopRequest,
    requestAutomation: noopRequest,
    activeTheme: PIWIN_APPEARANCE_DARK,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    searchModelCatalog: vi.fn(async () => ({ entries: [], catalogVersion: 'test' })),
    searchImageModelCatalog: vi.fn(async () => ({ entries: [], catalogVersion: 'test' })),
    storeProviderSecret: vi.fn(),
    loadProviderSecret: vi.fn(),
    onOpenSubagentSession: vi.fn(),
    requestSubAgent: noopRequest,
  } as SettingsContextValue;
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={value}>
              <VideoGenerationSettings />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  return { container, root };
}

describe('VideoGenerationSettings', () => {
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

  it('sets the default video model without rewriting provider models', async () => {
    const config = makeConfig();
    const originalModels = structuredClone(config.providers[0]?.models);
    const saved: PiwinConfig[] = [];
    ({ root, container } = renderSettings(config, async (next) => {
      saved.push(next);
      return true;
    }));

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="video-model-set-default"]')
        ?.click();
    });

    expect(saved.at(-1)?.videoGeneration?.defaultModel).toEqual({
      protocol: 'openai-compatible',
      providerId: 'video-provider',
      modelId: 'existing-video',
    });
    expect(saved.at(-1)?.providers[0]?.models).toEqual(originalModels);
    expect(container?.querySelector('[data-testid="video-add-model-submit"]')).toBeNull();
  });

  it('saves video protocol onto the existing model route', () => {
    const config = makeConfig();
    const saved: PiwinConfig[] = [];
    ({ root, container } = renderSettings(config, async (next) => {
      saved.push(next);
      return true;
    }));

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="video-model-edit-route"]')
        ?.click();
    });
    const style = container?.querySelector<HTMLSelectElement>(
      '[data-testid="model-edit-video-api-style"]',
    );
    expect(style).not.toBeNull();
    act(() => {
      if (!style) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value',
      )?.set;
      setter?.call(style, 'xgrok-videos');
      style.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="video-model-save-route"]')
        ?.click();
    });

    expect(saved.at(-1)?.providers[0]?.models[0]?.routes).toEqual({
      'video-generation': {
        apiStyle: 'xgrok-videos',
        path: '/videos/generations',
      },
    });
    expect(saved.at(-1)?.providers[0]?.models[0]?.capabilities).toEqual(['video-generation']);
    expect(saved.at(-1)?.providers[0]?.models).toHaveLength(1);
  });
});
