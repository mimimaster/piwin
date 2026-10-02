// @vitest-environment happy-dom
/**
 * PermissionsPage — Run Mode selector and permission settings page tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PermissionPreset, PiwinConfig } from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_LIGHT } from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { PermissionsPage } from './permissions-page';
import { webToDraft } from '../web-draft';
import {
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  type DesktopPreferences,
} from '../../ui-preferences';

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
    appearanceMode: 'light',
    lightTheme: { ...DEFAULT_LIGHT_THEME_SETTINGS },
    darkTheme: { ...DEFAULT_DARK_THEME_SETTINGS },
    ...overrides,
  };
}

function createConfig(preset: PermissionPreset = 'yolo'): PiwinConfig {
  const mode = preset === 'yolo' ? 'bypass' : 'auto';
  return {
    permissions: {
      mode,
      preset,
    },
  } as PiwinConfig;
}

function createContextValue(overrides?: Partial<SettingsContextValue>): SettingsContextValue {
  return {
    request: vi.fn(async () => ({
      type: 'response' as const,
      command: 'test',
      success: true as const,
      data: {},
    })),
    config: createConfig('yolo'),
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
    projectTrusted: false,
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
    activeTheme: PIWIN_APPEARANCE_LIGHT,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    testProviderConnection: vi.fn(),
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

describe('PermissionsPage', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    host?.remove();
    host = null;
    root = null;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function renderPage(
    contextValue: SettingsContextValue,
    locale: 'zh-CN' | 'en' = 'zh-CN',
  ): Promise<void> {
    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <DesktopLocaleProvider locale={locale} onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <PermissionsPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
  }

  it('renders 3 mode cards: Auto, Ask, YOLO', async () => {
    const ctx = createContextValue({ config: createConfig('auto') });
    await renderPage(ctx);

    const autoCard = host?.querySelector('[data-testid="settings-permission-mode-auto"]');
    const askCard = host?.querySelector('[data-testid="settings-permission-mode-ask"]');
    const yoloCard = host?.querySelector('[data-testid="settings-permission-mode-yolo"]');

    expect(autoCard).toBeTruthy();
    expect(askCard).toBeTruthy();
    expect(yoloCard).toBeTruthy();

    expect(autoCard?.classList.contains('is-active')).toBe(true);
    expect(askCard?.classList.contains('is-active')).toBe(false);
    expect(yoloCard?.classList.contains('is-active')).toBe(false);
  });

  it('reflects the YOLO active preset from config', async () => {
    const ctx = createContextValue({ config: createConfig('yolo') });
    await renderPage(ctx);

    const yoloCard = host?.querySelector('[data-testid="settings-permission-mode-yolo"]');
    expect(yoloCard?.classList.contains('is-active')).toBe(true);
    expect(yoloCard?.getAttribute('aria-checked')).toBe('true');
  });

  it('calls saveConfig when clicking a different mode card', async () => {
    const saveConfig = vi.fn(async () => true);
    const ctx = createContextValue({ config: createConfig('yolo'), saveConfig });
    await renderPage(ctx);

    const autoCard = host?.querySelector<HTMLButtonElement>(
      '[data-testid="settings-permission-mode-auto"]',
    );
    expect(autoCard).toBeTruthy();

    await act(async () => {
      autoCard?.click();
    });

    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: { mode: 'auto', preset: 'auto' },
      }),
    );
  });

  it('marks YOLO as restricted when an untrusted project is open', async () => {
    const ctx = createContextValue({
      config: createConfig('auto'),
      projectPath: '/Users/test/untrusted-repo',
      projectTrusted: false,
    });
    await renderPage(ctx);

    const yoloCard = host?.querySelector('[data-testid="settings-permission-mode-yolo"]');
    expect(yoloCard?.classList.contains('is-restricted')).toBe(true);
    expect(yoloCard?.textContent).toContain('未信任项目不可用');
  });

  it('renders mechanics notes and preserves backward-compatible testIds', async () => {
    const ctx = createContextValue();
    await renderPage(ctx);

    expect(host?.querySelector('[data-testid="settings-permission-mode-group"]')).toBeTruthy();
    expect(host?.querySelector('[data-testid="settings-permission-notes"]')).toBeTruthy();
  });

  it('keeps remembered permissions collapsed until the header is clicked', async () => {
    const ctx = createContextValue();
    await renderPage(ctx);

    const toggle = host?.querySelector<HTMLButtonElement>(
      '[data-testid="remembered-permissions-toggle"]',
    );
    const collapse = host?.querySelector<HTMLElement>(
      '[data-testid="remembered-permissions-collapse"]',
    );

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(collapse?.getAttribute('aria-hidden')).toBe('true');
    expect(collapse?.style.display).toBe('none');

    await act(async () => {
      toggle?.click();
    });

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(collapse?.getAttribute('aria-hidden')).toBe('false');
    expect(collapse?.style.display).toBe('block');
    expect(host?.querySelector('[data-testid="remembered-permissions-no-project"]')).toBeTruthy();

    await act(async () => {
      toggle?.click();
    });

    // The exit transition is browser-driven, so only the ARIA state is asserted here.
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(collapse?.getAttribute('aria-hidden')).toBe('true');
  });

  it('removes the feature-pill small print from all mode cards', async () => {
    await renderPage(createContextValue());
    expect(host?.querySelector('.mode-card-features')).toBeNull();
    expect(host?.textContent).not.toContain('硬性熔断兜底');
  });

  it('enables true YOLO with one checkbox save, without triggering the radio button', async () => {
    const saveConfig = vi.fn(async () => true);
    await renderPage(createContextValue({ config: createConfig('auto'), saveConfig }));
    const checkbox = host?.querySelector<HTMLInputElement>('[data-testid="settings-permission-true-yolo"]');
    expect(checkbox).toBeTruthy();
    expect(checkbox?.closest('button')).toBeNull();
    await act(async () => { checkbox?.click(); });
    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      permissions: { mode: 'unrestricted', preset: 'yolo' },
    }));
  });

  it('shows true YOLO as checked and unrestricted on an untrusted project; unchecking restores ordinary YOLO', async () => {
    const config = createConfig('yolo');
    config.permissions = { mode: 'unrestricted', preset: 'yolo' };
    const saveConfig = vi.fn(async () => true);
    await renderPage(createContextValue({ config, saveConfig, projectPath: '/repo', projectTrusted: false }));
    const checkbox = host?.querySelector<HTMLInputElement>('[data-testid="settings-permission-true-yolo"]');
    expect(checkbox?.checked).toBe(true);
    expect(host?.querySelector('[data-testid="settings-permission-mode-yolo"]')?.classList.contains('is-restricted')).toBe(false);
    expect(host?.querySelector('[data-testid="settings-permission-bypass-refused"]')).toBeNull();
    await act(async () => { checkbox?.click(); });
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ permissions: { mode: 'bypass', preset: 'yolo' } }));
  });

  it('keeps true YOLO when selecting the already active YOLO card, and clears it for Auto', async () => {
    const config = createConfig('yolo');
    config.permissions = { mode: 'unrestricted', preset: 'yolo' };
    const saveConfig = vi.fn(async () => true);
    await renderPage(createContextValue({ config, saveConfig }));
    await act(async () => { host?.querySelector<HTMLButtonElement>('[data-testid="settings-permission-mode-yolo"]')?.click(); });
    expect(saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ permissions: { mode: 'unrestricted', preset: 'yolo' } }));
    await act(async () => { host?.querySelector<HTMLButtonElement>('[data-testid="settings-permission-mode-auto"]')?.click(); });
    expect(saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ permissions: { mode: 'auto', preset: 'auto' } }));
  });

  it('disables the true YOLO checkbox while saving', async () => {
    await renderPage(createContextValue({ saving: true }));
    expect(host?.querySelector<HTMLInputElement>('[data-testid="settings-permission-true-yolo"]')?.disabled).toBe(true);
  });

  it('supports English locale labels and descriptions', async () => {
    const ctx = createContextValue({ config: createConfig('ask') });
    await renderPage(ctx, 'en');

    const askCard = host?.querySelector('[data-testid="settings-permission-mode-ask"]');
    expect(askCard?.classList.contains('is-active')).toBe(true);
    expect(askCard?.textContent).toContain('Strict');
    expect(askCard?.textContent).toContain('Step-by-step');
  });
});
