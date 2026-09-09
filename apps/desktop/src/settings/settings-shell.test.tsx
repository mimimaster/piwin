// @vitest-environment happy-dom
/**
 * SettingsShell coverage for slice R4 (all waves — registry covers every section).
 * Uses the same happy-dom + createRoot pattern as context-bar.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWebConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './section-registry';
import type { SettingsContextValue } from './settings-context';
import { ensureSettingsLazyLoaded } from './settings-lazy-load';
import { SettingsShell } from './settings-shell';
import { webToDraft } from './web-draft';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const noopRequest = vi.fn(async () => ({
  type: 'response' as const,
  command: 'test',
  success: true as const,
  // `config` satisfies panels (e.g. SkillsPanel) that read config/get on mount.
  data: { config: {} },
}));

function createContextValue(
  selectSection: (section: SettingsSectionId) => void,
): SettingsContextValue {
  return {
    request: noopRequest,
    config: null,
    root: '~/.piwin',
    saving: false,
    setError: vi.fn(),
    setInfo: vi.fn(),
    saveConfig: vi.fn(async () => true),
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
    selectSection,
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

function ShellHarness({
  initialSection = 'general',
}: {
  initialSection?: SettingsSectionId;
}): ReactElement {
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <SettingsShell
        activeSection={section}
        onSelectSection={setSection}
        contextValue={createContextValue(setSection)}
      />
    </PiwinUiProvider>
  );
}

describe('SettingsShell', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('requestIdleCallback', () => 0);
    vi.stubGlobal('cancelIdleCallback', () => undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders one nav item per registered section', () => {
    act(() => {
      root.render(<ShellHarness />);
    });
    for (const section of SETTINGS_SECTIONS) {
      expect(
        container.querySelector(`[data-testid="settings-nav-${section.id}"]`),
        `nav item for ${section.id}`,
      ).not.toBeNull();
    }
    expect(container.querySelectorAll('.settings-nav-item')).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it('renders the restored Web settings page', async () => {
    await act(async () => {
      root.render(<ShellHarness initialSection="web" />);
      await ensureSettingsLazyLoaded();
    });
    expect(container.querySelector('[data-testid="settings-nav-web"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="web-search-route-policy"]')).not.toBeNull();
  });

  it('uses the page content heading without rendering a duplicate shell title', async () => {
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsShell
            activeSection="knowledge"
            onSelectSection={vi.fn()}
            contextValue={createContextValue(vi.fn())}
            onClose={vi.fn()}
          />
        </PiwinUiProvider>,
      );
      await ensureSettingsLazyLoaded();
    });

    expect(container.querySelector('.settings-main-header h2')).toBeNull();
    expect(container.querySelector('.settings-main-content > .settings-card-heading')).toBeNull();
    expect(container.querySelector('[data-testid="settings-close-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-back-button"]')).not.toBeNull();
    expect(container.querySelector('.settings-main-heading h1')?.textContent).toBe('知识库与向量');
  });

  it('returns to the workspace from the sidebar back action', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsShell
            activeSection="general"
            onSelectSection={vi.fn()}
            contextValue={createContextValue(vi.fn())}
            onClose={onClose}
          />
        </PiwinUiProvider>,
      );
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-back-button"]')?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes a native window drag region while settings covers shell chrome', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsShell
            activeSection="general"
            onSelectSection={vi.fn()}
            contextValue={createContextValue(vi.fn())}
            onClose={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    const titlebar = container.querySelector('[data-testid="settings-titlebar"]');
    const dragStrip = container.querySelector('[data-testid="settings-titlebar-drag"]');
    expect(titlebar).not.toBeNull();
    expect(titlebar?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(dragStrip).not.toBeNull();
    expect(dragStrip?.hasAttribute('data-tauri-drag-region')).toBe(true);
    // Back control must opt out so clicks do not start a window move.
    expect(
      container
        .querySelector('[data-testid="settings-back-button"]')
        ?.closest('[data-no-window-drag]'),
    ).not.toBeNull();
  });

  it('switches content when a nav item is clicked', async () => {
    await act(async () => {
      root.render(<ShellHarness initialSection="extensions" />);
      await ensureSettingsLazyLoaded();
    });
    expect(container.querySelector('[data-testid="settings-extensions-hub"]')).not.toBeNull();

    // Models renders through the registry; config is null in this
    // harness, so the page shows its loading state.
    const modelsNav = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-nav-models"]',
    );
    expect(modelsNav).not.toBeNull();
    act(() => {
      modelsNav?.click();
    });
    expect(container.querySelector('[data-testid="settings-models-loading"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-extensions-hub"]')).toBeNull();

    // Registered page again: sessions.
    const sessionNav = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-nav-session"]',
    );
    act(() => {
      sessionNav?.click();
    });
    expect(container.querySelector('[data-testid="settings-models-loading"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="settings-nav-session"]')?.classList.contains('active'),
    ).toBe(true);
  });

  it('finds controls from consolidated sections and enters their category', () => {
    act(() => {
      root.render(<ShellHarness initialSection="models" />);
    });

    const search = container.querySelector<HTMLInputElement>('.settings-search-input');
    expect(search).not.toBeNull();
    act(() => {
      if (search) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'font');
        search.dispatchEvent(new Event('input', { bubbles: true }));
        search.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(container.querySelector('[data-testid="settings-nav-general"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-nav-models"]')).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-nav-general"]')?.click();
    });
    expect(container.querySelector('[data-testid="settings-general"]')).not.toBeNull();
  });

  it('renders the models page with provider settings when config is loaded', async () => {
    const contextValue = createContextValue(vi.fn());
    contextValue.config = {
      hostMode: 'sdk',
      providers: [
        {
          id: 'deepseek',
          protocol: 'openai-compatible',
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          models: [{ id: 'deepseek-chat', contextWindow: 64_000 }],
        },
      ],
      defaultProviderId: 'deepseek',
      defaultModelId: 'deepseek-chat',
      media: { maxPasteBytes: 1_000_000, allowedMimeTypes: [] },
      artifact: { enabled: true, triggerMode: 'automatic', decisionPrompt: { mode: 'default', customPrompt: '' }, maxBytes: 1_000_000 },
    };
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsShell
            activeSection="models"
            onSelectSection={vi.fn()}
            contextValue={contextValue}
          />
        </PiwinUiProvider>,
      );
      await ensureSettingsLazyLoaded();
    });
    expect(container.querySelector('[data-testid="settings-models"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-settings"]')).not.toBeNull();
    // Expand the provider row — model list / discover live on the models page.
    const providerRow = container.querySelector<HTMLElement>(
      '[data-testid="provider-row-deepseek"]',
    );
    expect(providerRow).not.toBeNull();
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-row-expand-deepseek"]')
        ?.click();
    });
    expect(container.querySelector('[data-testid="provider-row-models-deepseek"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-model-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-model-row"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="provider-discover-models-deepseek"]'),
    ).not.toBeNull();
  });

  it('renders consolidated sections through the registry, not the legacy fallback', async () => {
    act(() => {
      root.render(<ShellHarness />);
    });
    const extensionsNav = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-nav-extensions"]',
    );
    expect(extensionsNav).not.toBeNull();
    await act(async () => {
      extensionsNav?.click();
      await ensureSettingsLazyLoaded();
    });
    expect(container.querySelector('[data-testid="settings-extensions-hub"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="legacy-skills"]')).toBeNull();
  });

  it('updates artifact code-first preference through the checkbox', () => {
    const contextValue = createContextValue(vi.fn());
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsShell
            activeSection="general"
            onSelectSection={vi.fn()}
            contextValue={contextValue}
          />
        </PiwinUiProvider>,
      );
    });
    // Mantine Switch puts data-testid on the <input> (role="switch") directly.
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="artifact-code-first-switch"]',
    );
    expect(input).not.toBeNull();
    // Starts unchecked (defaults to false).
    expect(input?.checked).toBe(false);

    // Toggle on — clicking the input triggers onChange.
    act(() => {
      input?.click();
    });
    expect(contextValue.onPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({ artifactCodeFirst: true }),
    );

    // Toggle off.
    const mockFn = contextValue.onPreferencesChange as ReturnType<typeof vi.fn>;
    mockFn.mockClear();
    const contextValueOn = createContextValue(vi.fn());
    contextValueOn.preferences.artifactCodeFirst = true;
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsShell
            activeSection="general"
            onSelectSection={vi.fn()}
            contextValue={contextValueOn}
          />
        </PiwinUiProvider>,
      );
    });
    const inputOn = container.querySelector<HTMLInputElement>(
      '[data-testid="artifact-code-first-switch"]',
    );
    expect(inputOn).not.toBeNull();
    expect(inputOn?.checked).toBe(true);
    act(() => {
      inputOn?.click();
    });
    expect(contextValueOn.onPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({ artifactCodeFirst: false }),
    );
  });
});
