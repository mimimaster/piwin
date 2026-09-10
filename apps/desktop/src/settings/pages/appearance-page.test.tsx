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
  PIWIN_APPEARANCE_INK_WASH,
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
            {
              id: 'piwin-ink-wash',
              name: '砚夜泼墨',
              version: '1.0.0',
              mode: 'dark' as const,
              path: '/themes/piwin-ink-wash',
              source: 'bundled' as const,
              active: false,
            },
          ],
          activeThemeId: 'piwin-inkstone',
        },
      };
    }
    if (cmd.type === 'theme/set-active') {
      const theme: ThemeManifest =
        cmd.themeId === 'piwin-ink-wash'
          ? PIWIN_APPEARANCE_INK_WASH
          : cmd.themeId === 'piwin-inkstone-paper' || cmd.themeId === 'piwin-light'
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

  it('renders theme library dropdown and appearance controls', async () => {
    const contextValue = createContextValue();
    await renderPage(contextValue);

    const themeSelect = container.querySelector('[data-testid="theme-library-select"]');
    expect(themeSelect).not.toBeNull();
    expect((themeSelect as HTMLSelectElement | null)?.value).toBe('piwin-inkstone');
    expect(
      [...(themeSelect as HTMLSelectElement).options].some((option) => option.value === 'system'),
    ).toBe(false);

    const modeControl = container.querySelector('[data-testid="appearance-mode-control"]');
    expect(modeControl).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="inkstone-theme-preview"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="light-theme-preview"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="dark-theme-preview"]')).toHaveLength(0);
    expect(modeControl?.textContent).toContain('纸面');
    expect(modeControl?.textContent).toContain('墨面');
  });

  it('switches from ink-wash back to Inkstone and restores light appearance', async () => {
    const preferences = createPreferences({ appearanceMode: 'light' });
    const contextValue = createContextValue({
      activeTheme: PIWIN_APPEARANCE_INK_WASH,
      preferences,
    });

    await renderPage(contextValue);

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="theme-library-select"]',
    );
    expect(select).not.toBeNull();
    if (!select) return;
    expect(select.value).toBe('piwin-ink-wash');

    await act(async () => {
      select.value = 'piwin-inkstone';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(contextValue.request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'theme/set-active',
        themeId: 'piwin-inkstone-paper',
      }),
    );
    expect(contextValue.onThemeApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'piwin-inkstone-paper',
        mode: 'light',
        tokens: expect.objectContaining({
          bg: DEFAULT_LIGHT_THEME_SETTINGS.background.toLowerCase(),
        }),
      }),
    );
    expect(contextValue.setInfo).toHaveBeenCalledWith('已切换到 Inkstone。', 'success');
  });

  it('switches from ink-wash back to Inkstone and applies custom dark settings', async () => {
    const customDarkSettings = {
      preset: 'default' as const,
      background: '#090A0F',
      foreground: '#D0D0D0',
      accent: '#FF5500',
    };
    const preferences = createPreferences({
      appearanceMode: 'dark',
      darkTheme: customDarkSettings,
    });
    const contextValue = createContextValue({
      activeTheme: PIWIN_APPEARANCE_INK_WASH,
      preferences,
    });

    await renderPage(contextValue);

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="theme-library-select"]',
    );
    expect(select).not.toBeNull();
    if (!select) return;

    await act(async () => {
      select.value = 'piwin-inkstone';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(contextValue.request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'theme/set-active',
        themeId: 'piwin-inkstone-ink',
      }),
    );
    expect(contextValue.onThemeApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'piwin-dark-appearance',
        mode: 'dark',
        tokens: expect.objectContaining({
          bg: '#090A0F',
          text: '#D0D0D0',
          accent: '#FF5500',
        }),
      }),
    );
  });

  it('switches from Inkstone to ink-wash correctly', async () => {
    const contextValue = createContextValue({
      activeTheme: PIWIN_APPEARANCE_DARK,
    });

    await renderPage(contextValue);

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="theme-library-select"]',
    );
    expect(select).not.toBeNull();
    if (!select) return;
    expect(select.value).toBe('piwin-inkstone');

    await act(async () => {
      select.value = 'piwin-ink-wash';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(contextValue.request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'theme/set-active',
        themeId: 'piwin-ink-wash',
      }),
    );
    expect(contextValue.onThemeApplied).toHaveBeenCalledWith(PIWIN_APPEARANCE_INK_WASH);
    expect(contextValue.setInfo).toHaveBeenCalledWith('已切换到 砚夜泼墨。', 'success');
  });

  it('ignores redundant switch when selecting the currently active theme', async () => {
    const contextValue = createContextValue({
      activeTheme: PIWIN_APPEARANCE_DARK,
    });

    await renderPage(contextValue);

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="theme-library-select"]',
    );
    expect(select).not.toBeNull();
    if (!select) return;

    await act(async () => {
      select.value = 'piwin-inkstone';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(contextValue.onThemeApplied).not.toHaveBeenCalled();
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
    const contextValue = createContextValue({
      activeTheme: PIWIN_APPEARANCE_INK_WASH,
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

  it('does not surface raw Host ENOENT when selecting Inkstone', async () => {
    const contextValue = createContextValue({
      activeTheme: PIWIN_APPEARANCE_INK_WASH,
      preferences: createPreferences({ appearanceMode: 'light' }),
    });
    contextValue.request = vi.fn(async (cmd) => {
      if (cmd.type === 'theme/list') {
        return {
          id: '1',
          type: 'response' as const,
          command: 'theme/list',
          success: true as const,
          data: { themes: [], activeThemeId: 'piwin-ink-wash' },
        };
      }
      return {
        id: '2',
        type: 'response' as const,
        command: 'theme/set-active',
        success: false as const,
        error: "ENOENT: no such file or directory, open '[host-path]'",
      };
    });

    await renderPage(contextValue);

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="theme-library-select"]',
    );
    expect(select).not.toBeNull();
    if (!select) return;

    await act(async () => {
      select.value = 'piwin-inkstone';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(contextValue.setError).toHaveBeenCalledWith(
      '这个主题 Host 上还没有，还停在当前主题。',
    );
    expect(contextValue.onThemeApplied).not.toHaveBeenCalled();
  });
});
