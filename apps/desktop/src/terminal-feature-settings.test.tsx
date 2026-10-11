// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { loadDesktopPreferences } from './ui-preferences';

const settings = vi.hoisted(() => ({
  desktop: true,
  enabled: undefined as boolean | undefined,
  changed: vi.fn(),
}));
vi.mock('./shell-runtime.js', () => ({ isDesktopTauriRuntime: () => settings.desktop }));
vi.mock('./desktop-locale-context.js', () => ({ useDesktopLocale: () => ({ locale: 'zh-CN' }) }));
vi.mock('./settings/settings-context.js', () => ({
  useSettings: () => ({
    preferences: { ...loadDesktopPreferences(), ...(settings.enabled === undefined ? {} : { terminalEnabled: settings.enabled }) },
    onPreferencesChange: settings.changed,
  }),
}));
import { TerminalFeatureSettings } from './terminal-feature-settings';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  settings.desktop = true;
  settings.enabled = undefined;
  settings.changed.mockClear();
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
function render() {
  act(() => root.render(
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><TerminalFeatureSettings /></PiwinUiProvider>,
  ));
  return container.querySelector<HTMLInputElement>('[data-testid="terminal-feature-switch"]');
}

describe('terminal setting', () => {
  it('starts enabled in tests and allows an explicit disable', () => {
    const control = render();
    expect(control?.checked).toBe(true);
    act(() => control?.click());
    expect(settings.changed).toHaveBeenCalledWith(expect.objectContaining({ terminalEnabled: false }));
  });
  it('shows and can enable a saved disabled preference', () => {
    settings.enabled = false;
    const control = render();
    expect(control?.checked).toBe(false);
    act(() => control?.click());
    expect(settings.changed).toHaveBeenCalledWith(expect.objectContaining({ terminalEnabled: true }));
  });
  it('does not expose native terminal controls on browser or phone shells', () => {
    settings.desktop = false;
    expect(render()).toBeNull();
    expect(container.querySelector('[data-testid="terminal-feature-settings"]')).toBeNull();
  });
});
