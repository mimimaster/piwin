// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../theme/appearance-tokens.js';
import type { DesktopPreferences } from '../../platform/ui-preferences';

const mocks = vi.hoisted(() => ({
  setShortcutEnabled: vi.fn(async () => undefined),
  onPreferencesChange: vi.fn(),
  state: { preferences: undefined as unknown as DesktopPreferences },
}));

vi.mock('../../i18n/desktop-locale-context', () => ({
  useDesktopLocale: () => ({ locale: 'zh-CN', setLocale: vi.fn() }),
}));

vi.mock('../../screen-capture/screen-capture-os-tauri.js', () => ({
  createTauriScreenCaptureOs: () => ({ setShortcutEnabled: mocks.setShortcutEnabled }),
}));

vi.mock('../settings-context', () => ({
  useSettings: () => ({
    preferences: mocks.state.preferences,
    onPreferencesChange: mocks.onPreferencesChange,
    saveConfig: vi.fn(),
    setInfo: vi.fn(),
  }),
}));

const { ScreenCaptureSettings } = await import('./general-page');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function basePreferences(screenCaptureEnabled?: boolean): DesktopPreferences {
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
    lightTheme: { preset: 'bone', background: '#fff', foreground: '#000', accent: '#000' },
    darkTheme: { preset: 'noir', background: '#000', foreground: '#fff', accent: '#fff' },
    ...(screenCaptureEnabled === undefined ? {} : { screenCaptureEnabled }),
  };
}

describe('Settings → General screen capture switch', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    mocks.setShortcutEnabled.mockClear();
    mocks.onPreferencesChange.mockReset();
    // Mirrors the real owner (use-workbench-desktop-config): the callback both
    // persists and replaces the preferences the settings tree renders from.
    mocks.onPreferencesChange.mockImplementation((next: DesktopPreferences) => {
      mocks.state.preferences = next;
    });
    mocks.state.preferences = basePreferences();
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  async function renderSwitch(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ScreenCaptureSettings />
        </PiwinUiProvider>,
      );
    });
    return container;
  }

  function switchInput(element: HTMLDivElement): HTMLInputElement | null {
    return element.querySelector<HTMLInputElement>(
      'input[data-testid="settings-screen-capture-switch"]',
    );
  }

  it('renders the switch as on by default', async () => {
    const element = await renderSwitch();
    expect(element.textContent).toContain('截图');
    expect(switchInput(element)?.checked).toBe(true);
  });

  it('flips off through the settings owner and releases the native shortcut', async () => {
    const element = await renderSwitch();
    const input = switchInput(element);
    expect(input).not.toBeNull();

    await act(async () => {
      input?.click();
    });
    expect(mocks.onPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({ screenCaptureEnabled: false }),
    );
    expect(mocks.setShortcutEnabled).toHaveBeenCalledWith(false);

    // Re-render from the owner's new preferences: the controlled switch stays off.
    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ScreenCaptureSettings />
        </PiwinUiProvider>,
      );
    });
    expect(switchInput(element)?.checked).toBe(false);
  });
});
