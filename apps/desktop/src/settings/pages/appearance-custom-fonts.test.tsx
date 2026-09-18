// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_LIGHT } from '../../appearance-tokens.js';
import { AppearanceCustomFonts } from './appearance-custom-fonts.js';
import { getDesktopCopy } from '../../desktop-locale.js';
import {
  clearCustomFonts,
  saveCustomFont,
} from '../../theme/font-storage.js';
import {
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  type DesktopPreferences,
} from '../../ui-preferences.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const mockPreferences: DesktopPreferences = {
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
};

describe('AppearanceCustomFonts', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await clearCustomFonts();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  it('renders typography font selects and empty state initially', async () => {
    const copy = getDesktopCopy('zh-CN').appearance;
    const onChange = vi.fn();

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <AppearanceCustomFonts
            preferences={mockPreferences}
            onChange={onChange}
            copy={copy}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container?.querySelector('[data-testid="settings-custom-fonts"]')).toBeTruthy();
    expect(container?.querySelector('[data-testid="custom-sans-font-select"]')).toBeTruthy();
    expect(container?.querySelector('[data-testid="custom-mono-font-select"]')).toBeTruthy();
    expect(container?.querySelector('[data-testid="custom-serif-font-select"]')).toBeTruthy();
    expect(container?.textContent).toContain(copy.noUploadedFonts);
  });

  it('renders uploaded font card and allows assignment to roles', async () => {
    const copy = getDesktopCopy('zh-CN').appearance;
    const onChange = vi.fn();

    await saveCustomFont({
      family: 'Anthropic Sans',
      fileName: 'Anthropic Sans.ttf',
      format: 'truetype',
      data: new Uint8Array([1, 2, 3]).buffer,
    });

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <AppearanceCustomFonts
            preferences={mockPreferences}
            onChange={onChange}
            copy={copy}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    // Wait for microtask tick for font loading
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.querySelector('[data-testid="font-card-Anthropic Sans"]')).toBeTruthy();
    expect(container?.textContent).toContain('Anthropic Sans');

    const sansPill = Array.from(container?.querySelectorAll('.custom-font-pill-btn') ?? []).find(
      (btn) => btn.textContent?.includes('界面字体'),
    );
    expect(sansPill).toBeTruthy();

    await act(async () => {
      sansPill?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        customFonts: {
          sansFont: 'Anthropic Sans',
        },
      }),
    );
  });

  it('resets custom fonts when reset button is clicked', async () => {
    const copy = getDesktopCopy('zh-CN').appearance;
    const onChange = vi.fn();

    const prefsWithFonts: DesktopPreferences = {
      ...mockPreferences,
      customFonts: {
        sansFont: 'Anthropic Sans',
      },
    };

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <AppearanceCustomFonts
            preferences={prefsWithFonts}
            onChange={onChange}
            copy={copy}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const resetBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="reset-fonts-button"]',
    );
    expect(resetBtn).toBeTruthy();

    await act(async () => {
      resetBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        customFonts: undefined,
      }),
    );
  });
});
