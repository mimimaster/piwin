// @vitest-environment happy-dom
/**
 * AppearancePage — settings appearance page tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWebConfig, type ThemeManifest } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import {
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_LIGHT,
} from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { AppearancePage } from './appearance-page';
import { webToDraft } from '../web-draft';
import {
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  type DesktopPreferences,
} from '../../ui-preferences';
import type { SettingsConfigRequest } from '../settings-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createPreferences(overrides?: Partial<DesktopPreferences>): DesktopPreferences {
  return {
    assistantTextSize: 'default',
    codeTextSize: 'default',
    codeWrap: false,
    toolDensity: 'comfortable',
    workDetailsExpanded: 'auto',
    artifactCodeFirst: false,
    verboseAgentChat: true,
    conversationWidth: 'default',
    appearanceMode: 'system',
    lightTheme: { ...DEFAULT_LIGHT_THEME_SETTINGS },
    darkTheme: { ...DEFAULT_DARK_THEME_SETTINGS },
    ...overrides,
  };
}

function createContextValue(
  overrides?: Partial<SettingsContextValue>,
): SettingsContextValue {
  const defaultRequest: SettingsConfigRequest = vi.fn(async (cmd) => {
    if (cmd.type === 'theme/list') {
      return {
        id: '1',
        type: 'response' as const,
        command: 'theme/list',
        success: true as const,
        data: {
          themes: [
            {
              id: 'piwin-inkstone',
              name: 'Inkstone',
              version: '2.0.0',
              mode: 'light' as const,
              path: '/themes/piwin-inkstone',
              source: 'bundled' as const,
              active: true,
            },
          ],
          activeThemeId: 'piwin-inkstone',
        },
      };
    }
    if (cmd.type === 'theme/set-active') {
      const theme: ThemeManifest =
        cmd.themeId === 'piwin-inkstone-paper' || cmd.themeId === 'piwin-light'
          ? PIWIN_APPEARANCE_LIGHT
          : PIWIN_APPEARANCE_DARK;
      return {
        id: '2',
        type: 'response' as const,
        command: 'theme/set-active',
        success: true as const,
        data: { theme },
      };
    }
    return { id: '0', type: 'response' as const, command: cmd.type, success: true as const, data: {} };
  });

  return {
    request: defaultRequest,
    config: null,
    root: '~/.piwin',
    saving: false,
    setError: vi.fn(),
    setInfo: vi.fn(),
    saveConfig: vi.fn(async () => true),
    webDraft: webToDraft(createDefaultWebConfig()),
    setWebDraft: vi.fn(),
    saveWeb: vi.fn(async () => true),
    preferences: createPreferences(),
    onPreferencesChange: vi.fn(),
    projectPath: null,
    projectTrusted: true,
    hostStatus: null,
    activeSessionId: null,
    onOpenSubagentSession: undefined,
    selectSection: vi.fn(),
    requestSkills: vi.fn(),
    requestMcp: vi.fn(),
    requestExtensions: vi.fn(),
    requestPlugins: vi.fn(),
    requestPrompts: vi.fn(),
    requestPet: vi.fn(),
    requestAutomation: vi.fn(),
    requestSubAgent: undefined,
    activeTheme: PIWIN_APPEARANCE_DARK,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    searchModelCatalog: vi.fn(),
    searchImageModelCatalog: vi.fn(),
    getModelCatalogStatus: vi.fn(async () => ({
      source: 'pi-bootstrap' as const,
      catalogVersion: 'test',
      entryCount: 0,
      imageEntryCount: 0,
    })),
    syncModelCatalog: vi.fn(async () => ({
      ok: true as const,
      source: 'models.dev' as const,
      catalogVersion: 'test',
      fetchedAt: '2026-09-21T00:00:00.000Z',
      entryCount: 1,
      imageEntryCount: 0,
    })),
    storeProviderSecret: vi.fn(),
    loadProviderSecret: vi.fn(),
    ...overrides,
  };
}

describe('AppearancePage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    vi.clearAllMocks();
  });

  async function renderPage(contextValue: SettingsContextValue, locale: 'zh-CN' | 'en' = 'zh-CN') {
    await act(async () => {
      root.render(
        <DesktopLocaleProvider locale={locale} onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={contextValue.activeTheme}>
            <SettingsProvider value={contextValue}>
              <AppearancePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });
  }

  it('renders appearance mode controls and settings', async () => {
    const contextValue = createContextValue();
    await renderPage(contextValue);

    const modeControl = container.querySelector('[data-testid="appearance-mode-control"]');
    expect(modeControl).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="inkstone-theme-preview"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="light-theme-preview"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="dark-theme-preview"]')).toHaveLength(0);
    expect(modeControl?.textContent).toContain('纸面');
    expect(modeControl?.textContent).toContain('墨面');
  });

  it('updates appearance mode and applies corresponding theme when not locked by theme package', async () => {
    const contextValue = createContextValue({
      activeTheme: PIWIN_APPEARANCE_DARK,
    });

    await renderPage(contextValue);

    const lightRadio = container.querySelector(
      'input[value="light"]',
    ) as HTMLInputElement | null;
    expect(lightRadio).not.toBeNull();
    if (!lightRadio) return;

    await act(async () => {
      lightRadio.click();
    });

    expect(contextValue.onPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({ appearanceMode: 'light' }),
    );
    expect(contextValue.onThemeApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'piwin-inkstone-paper',
        mode: 'light',
      }),
    );
  });

  it('blocks appearance mode changes when theme package is active', async () => {
    const lockedTheme: ThemeManifest = {
      ...PIWIN_APPEARANCE_DARK,
      id: 'custom-locked-theme',
      visualStyle: 'flat',
    };
    const contextValue = createContextValue({
      activeTheme: lockedTheme,
    });

    await renderPage(contextValue);

    const lightRadio = container.querySelector(
      'input[value="light"]',
    ) as HTMLInputElement | null;
    expect(lightRadio).not.toBeNull();
    if (!lightRadio) return;

    await act(async () => {
      lightRadio.click();
    });

    expect(contextValue.onPreferencesChange).not.toHaveBeenCalled();
    expect(contextValue.onThemeApplied).not.toHaveBeenCalled();
  });
});
