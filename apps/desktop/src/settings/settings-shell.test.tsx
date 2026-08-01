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
    saveWeb: vi.fn(async () => undefined),
    preferences: {
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
      toolDensity: 'comfortable',
      workDetailsExpanded: 'auto',
      artifactPreviewEnabled: true,
      artifactCodeFirst: false,
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
    requestPrompts: noopRequest,
    requestTheme: noopRequest,
    requestPet: noopRequest,
    requestAutomation: noopRequest,
    requestSubAgent: undefined,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    searchModelCatalog: vi.fn(async () => ({ entries: [], catalogVersion: 'test' })),
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
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
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

  it('switches content when a nav item is clicked', () => {
    act(() => {
      root.render(<ShellHarness initialSection="skills" />);
    });
    // Registered Wave-1 page (skills) renders through the registry; it also
    // carries the merged rules placeholder.
    expect(container.querySelector('[data-testid="settings-rules-empty"]')).not.toBeNull();

    // Models (Wave 3) renders through the registry; config is null in this
    // harness, so the page shows its loading state.
    const modelsNav = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-nav-models"]',
    );
    expect(modelsNav).not.toBeNull();
    act(() => {
      modelsNav?.click();
    });
    expect(container.querySelector('[data-testid="settings-models-loading"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-rules-empty"]')).toBeNull();

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

  it('renders the models page with provider settings when config is loaded', () => {
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
      artifact: { maxBytes: 1_000_000, htmlUiModeDefault: false },
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsShell
            activeSection="models"
            onSelectSection={vi.fn()}
            contextValue={contextValue}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="settings-models"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-settings"]')).not.toBeNull();
    // Model directory row with inline-expandable runtime limits.
    expect(container.querySelector('[data-testid="model-dir-row"]')).not.toBeNull();
    const row = container.querySelector<HTMLButtonElement>('[data-testid="model-dir-row"]');
    act(() => {
      row?.click();
    });
    expect(container.querySelector('[data-testid="model-edit-context"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="model-edit-output"]')).not.toBeNull();
  });

  it('renders Wave-2 sections through the registry, not the legacy fallback', async () => {
    act(() => {
      root.render(<ShellHarness />);
    });
    const skillsNav = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-nav-skills"]',
    );
    expect(skillsNav).not.toBeNull();
    // Async act flushes SkillsPanel's on-mount host requests.
    await act(async () => {
      skillsNav?.click();
    });
    expect(container.querySelector('[data-testid="settings-skills"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="legacy-skills"]')).toBeNull();
  });

  it('renders the Code-first mode switch on the Appearance page and toggles it', () => {
    const contextValue = createContextValue(vi.fn());
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsShell
            activeSection="appearance"
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
            activeSection="appearance"
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
