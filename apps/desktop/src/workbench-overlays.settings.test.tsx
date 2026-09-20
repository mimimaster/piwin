// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIWIN_APPEARANCE_INKSTONE_PAPER } from './theme/deck-palette';
import type { DesktopPreferences } from './ui-preferences';
import { WorkbenchSettingsOverlay } from './workbench-overlays';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./deferred-desktop-surfaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./deferred-desktop-surfaces')>();
  function SettingsPanelStub(): ReactElement {
    return <div data-testid="settings-panel-stub">settings</div>;
  }
  return {
    ...actual,
    DeferredSettingsPanel: SettingsPanelStub,
    createDeferredSettingsPanel: () => SettingsPanelStub,
  };
});

const preferences = {
  assistantTextSize: 'md',
  codeTextSize: 'md',
  codeWrap: false,
  toolDensity: 'comfortable',
  workDetailsExpanded: 'default',
  artifactCodeFirst: false,
  verboseAgentChat: false,
  conversationWidth: 'default',
  appearanceMode: 'light',
  lightTheme: { themeId: 'piwin-inkstone-paper' },
  darkTheme: { themeId: 'piwin-inkstone-ink' },
} as unknown as DesktopPreferences;

const noop = (): void => {};
const asyncNoop = async (): Promise<never> => {
  throw new Error('not used');
};

function overlayProps(settingsOpen: boolean): ComponentProps<typeof WorkbenchSettingsOverlay> {
  return {
    settingsOpen,
    locale: 'zh-CN',
    hostStatus: null,
    hostClient: { request: asyncNoop } as never,
    requestConfig: asyncNoop as never,
    preferences,
    activeTheme: PIWIN_APPEARANCE_INKSTONE_PAPER,
    onPreferencesChange: noop,
    settingsSection: 'general',
    onSettingsSectionChange: noop,
    state: {
      projectPath: null,
      projectTrusted: false,
      sessions: [],
      generalSessions: [],
      subagentChildren: {},
      subagentBatches: {},
      subagentInvocations: {},
      activeSessionId: null,
    } as never,
    requestSkills: asyncNoop as never,
    requestMcp: asyncNoop as never,
    requestExtensions: asyncNoop as never,
    requestPlugins: asyncNoop as never,
    requestPrompts: asyncNoop as never,
    requestPet: asyncNoop as never,
    requestAutomation: asyncNoop as never,
    requestSubAgent: asyncNoop as never,
    onOpenSubagentSession: noop,
    onThemeApplied: noop,
    onPetActiveChanged: noop,
    onCloseSettings: noop,
    onSettingsSaved: noop,
    config: null,
  };
}

describe('WorkbenchSettingsOverlay', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('covers the window as soon as settings open, even before the panel chunk paints', () => {
    act(() => {
      root.render(<WorkbenchSettingsOverlay {...overlayProps(true)} />);
    });
    const host = container.querySelector('[data-testid="settings-overlay-host"]');
    expect(host).not.toBeNull();
    expect(host?.classList.contains('settings-overlay-host')).toBe(true);
    expect(container.querySelector('[data-testid="settings-panel-stub"]')?.textContent).toBe(
      'settings',
    );
  });

  it('pins the overlay host in always-loaded shell CSS so a lazy settings chunk cannot blank the stage', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/region-shell.css'), 'utf8');
    expect(css).toContain('.settings-overlay-host');
    expect(css).toContain('position: fixed');
    expect(css).toContain('z-index: var(--layer-settings)');
  });

  it('does not leave a host mounted when settings are closed', () => {
    act(() => {
      root.render(<WorkbenchSettingsOverlay {...overlayProps(false)} />);
    });
    expect(container.querySelector('[data-testid="settings-overlay-host"]')).toBeNull();
  });
});
