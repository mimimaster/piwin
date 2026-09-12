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

    const autoCard = host?.querySelector<HTMLButtonElement>('[data-testid="settings-permission-mode-auto"]');
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

  it('supports English locale labels and descriptions', async () => {
    const ctx = createContextValue({ config: createConfig('ask') });
    await renderPage(ctx, 'en');

    const askCard = host?.querySelector('[data-testid="settings-permission-mode-ask"]');
    expect(askCard?.classList.contains('is-active')).toBe(true);
    expect(askCard?.textContent).toContain('Strict');
    expect(askCard?.textContent).toContain('Step-by-step');
  });
});
