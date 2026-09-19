// @vitest-environment happy-dom
/**
 * A failed settings lazy-load used to leave the shell on "loading this settings
 * page" forever: `ensureSettingsLazyLoaded()` cached the rejected promise, so
 * the section never registered and every later attempt replayed the failure.
 * Visually that is indistinguishable from a nav tab that was never wired up —
 * the reported symptom. The shell must say what happened and offer a retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { ShellHarness, createContextValue } from './settings-shell-test-harness';
import { SettingsShell } from './settings-shell';

const mocks = vi.hoisted(() => ({
  ensureSettingsLazyLoaded: vi.fn<() => Promise<void>>(),
}));

vi.mock('./settings-lazy-load', () => ({
  ensureSettingsLazyLoaded: mocks.ensureSettingsLazyLoaded,
  isSettingsBasicSection: (id: string) => id === 'general',
  SETTINGS_BASIC_SECTION_IDS: ['general'],
}));

describe('SettingsShell lazy-load failure', () => {
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
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  /** `code-search` is a non-basic section, so the shell must consult the loader. */
  async function renderWithFailedLoad(): Promise<void> {
    mocks.ensureSettingsLazyLoaded.mockRejectedValue(new Error('chunk load failed'));
    await act(async () => {
      root.render(<ShellHarness initialSection="code-search" />);
      await Promise.resolve();
    });
  }

  it('reports the failure instead of spinning forever', async () => {
    await renderWithFailedLoad();

    expect(container.querySelector('[data-testid="settings-section-load-error"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="settings-section-load-error-notice"]')?.textContent,
    ).toContain('chunk load failed');
    // The endless spinner is exactly the false "nothing is wired up" signal.
    expect(container.querySelector('[data-testid="settings-section-loading"]')).toBeNull();
  });

  it('retries the load when the user asks again', async () => {
    await renderWithFailedLoad();
    expect(mocks.ensureSettingsLazyLoaded).toHaveBeenCalledTimes(1);

    const retry = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-section-load-error-notice"] button',
    );
    expect(retry).not.toBeNull();

    mocks.ensureSettingsLazyLoaded.mockResolvedValue(undefined);
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });

    expect(mocks.ensureSettingsLazyLoaded).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="settings-section-load-error"]')).toBeNull();
  });

  it('keeps the error visible while the retry also fails', async () => {
    await renderWithFailedLoad();

    const retry = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-section-load-error-notice"] button',
    );
    mocks.ensureSettingsLazyLoaded.mockRejectedValue(new Error('still failing'));
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });

    expect(mocks.ensureSettingsLazyLoaded).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[data-testid="settings-section-load-error-notice"]')?.textContent,
    ).toContain('still failing');
  });

  it('renders the shell normally when the section is on the basic path', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsShell
            activeSection="general"
            onSelectSection={vi.fn()}
            contextValue={createContextValue(vi.fn())}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="settings-nav-general"]')).not.toBeNull();
    expect(mocks.ensureSettingsLazyLoaded).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="settings-section-load-error"]')).toBeNull();
  });
});
