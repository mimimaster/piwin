// @vitest-environment happy-dom
/**
 * Proves PiwinUiProvider re-derives its Mantine theme when the required
 * `manifest` prop changes (dark → light). Reads public theme values through
 * useMantineTheme; never asserts private Mantine class hashes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMantineTheme } from '@mantine/core';
import { PiwinUiProvider } from './piwin-ui-provider.js';
import { TEST_THEME_DARK, TEST_THEME_LIGHT } from './test-theme-fixtures.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type ObservedTheme = {
  fontFamily: string | undefined;
  primaryAccent: string | undefined;
  graphiteEnd: string | undefined;
};

let observed: ObservedTheme | null = null;

function ThemeProbe(): null {
  const theme = useMantineTheme();
  observed = {
    fontFamily: theme.fontFamily,
    // Mantine filled components use primary-color index 5.
    primaryAccent: theme.colors.piwinAccent?.[5],
    graphiteEnd: theme.colors.piwinGraphite?.[9],
  };
  return null;
}

describe('PiwinUiProvider manifest rerender', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    observed = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('re-derives Mantine values when the manifest prop changes from dark to light', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={TEST_THEME_DARK}>
          <ThemeProbe />
        </PiwinUiProvider>,
      );
    });

    expect(observed).not.toBeNull();
    const darkObserved = observed as unknown as ObservedTheme;
    expect(darkObserved.fontFamily).toBe(TEST_THEME_DARK.tokens.font);
    expect(darkObserved.primaryAccent).toBe(TEST_THEME_DARK.tokens.accent);
    expect(darkObserved.graphiteEnd).toBe(TEST_THEME_DARK.tokens.bg);

    act(() => {
      root.render(
        <PiwinUiProvider manifest={TEST_THEME_LIGHT}>
          <ThemeProbe />
        </PiwinUiProvider>,
      );
    });

    const lightObserved = observed as unknown as ObservedTheme;
    expect(lightObserved.fontFamily).toBe(TEST_THEME_LIGHT.tokens.font);
    expect(lightObserved.primaryAccent).toBe(TEST_THEME_LIGHT.tokens.accent);
    expect(lightObserved.primaryAccent).not.toBe(TEST_THEME_DARK.tokens.accent);
    expect(lightObserved.fontFamily).not.toBe(TEST_THEME_DARK.tokens.font);
  });
});
