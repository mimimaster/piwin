// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_LIGHT } from '../../theme/appearance-tokens.js';
import {
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  type DesktopPreferences,
} from '../../platform/ui-preferences.js';
import { AppearanceLightPresets } from './appearance-light-presets.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('AppearanceLightPresets', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const basePreferences: DesktopPreferences = {
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
  };

  it('renders modern and paper light style presets', () => {
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <AppearanceLightPresets
            preferences={basePreferences}
            onChange={vi.fn()}
            onThemeApplied={vi.fn()}
            activeTheme={PIWIN_APPEARANCE_LIGHT}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const cards = container?.querySelectorAll('.appearance-preset-card');
    expect(cards?.length).toBe(2);

    const modern = container?.querySelector('[data-testid="light-preset-modern"]');
    const paper = container?.querySelector('[data-testid="light-preset-paper"]');

    expect(modern?.getAttribute('aria-checked')).toBe('false');
    expect(paper?.getAttribute('aria-checked')).toBe('true');
  });

  it('selects modern preset and triggers preference & theme change', () => {
    const onChange = vi.fn();
    const onThemeApplied = vi.fn();

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <AppearanceLightPresets
            preferences={basePreferences}
            onChange={onChange}
            onThemeApplied={onThemeApplied}
            activeTheme={PIWIN_APPEARANCE_LIGHT}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const modern = container?.querySelector('[data-testid="light-preset-modern"]') as HTMLButtonElement;
    act(() => {
      modern?.click();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0]?.[0] as DesktopPreferences;
    expect(updated.lightTheme.preset).toBe('modern');
    expect(updated.lightTheme.background).toBe('#E2E5E9');

    expect(onThemeApplied).toHaveBeenCalledTimes(1);
    const appliedTheme = onThemeApplied.mock.calls[0]?.[0];
    expect(appliedTheme.id).toBe('piwin-inkstone-paper-modern');
  });
});
