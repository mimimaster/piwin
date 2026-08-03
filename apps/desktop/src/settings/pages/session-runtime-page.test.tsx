// @vitest-environment happy-dom
/**
 * SessionRuntimePage — runtime status + Pending Changes (spec §12.5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PiwinConfig, SessionRuntimeStatus } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { SessionRuntimePage } from './session-runtime-page';
import { webToDraft } from '../web-draft';
import { createDefaultWebConfig } from '@piwin/contracts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function baseConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: { maxBytes: 1024, htmlUiModeDefault: false },
  };
}

function staleStatus(): SessionRuntimeStatus {
  return {
    sessionId: 's1',
    state: 'stale',
    generationId: 's1-gen-1',
    staleDomains: ['web', 'skills'],
  };
}

function liveStatus(): SessionRuntimeStatus {
  return { sessionId: 's1', state: 'live', generationId: 's1-gen-1', staleDomains: [] };
}

function createContextValue(overrides: Partial<SettingsContextValue> = {}): SettingsContextValue {
  return {
    request: vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/runtime-status',
      success: true as const,
      data: { status: liveStatus() },
    })),
    config: baseConfig(),
    root: '~/.piwin',
    saving: false,
    setError: vi.fn(),
    setInfo: vi.fn(),
    saveConfig: vi.fn(async () => true),
    webDraft: webToDraft(createDefaultWebConfig()),
    setWebDraft: vi.fn(),
    saveWeb: vi.fn(async () => true),
    preferences: { assistantTextSize: 'default', codeTextSize: 'default', codeWrap: false },
    onPreferencesChange: vi.fn(),
    projectPath: null,
    projectTrusted: false,
    hostStatus: null,
    activeSessionId: 's1',
    onOpenSubagentSession: undefined,
    selectSection: vi.fn(),
    requestSkills: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestMcp: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestExtensions: vi.fn(async () => ({
      type: 'response',
      command: 'x',
      success: true,
      data: {},
    })),
    requestPlugins: vi.fn(async () => ({
      type: 'response',
      command: 'x',
      success: true,
      data: {},
    })),
    requestPrompts: vi.fn(async () => ({
      type: 'response',
      command: 'x',
      success: true,
      data: {},
    })),
    requestTheme: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestPet: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestAutomation: vi.fn(async () => ({
      type: 'response',
      command: 'x',
      success: true,
      data: {},
    })),
    requestSubAgent: undefined,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(async () => ({ models: [] })),
    testProviderModel: vi.fn(async () => ({ durationMs: 1 })),
    searchModelCatalog: vi.fn(async () => ({ items: [] })),
    storeProviderSecret: vi.fn(async () => 'ref'),
    loadProviderSecret: vi.fn(async () => null),
    ...overrides,
  } as unknown as SettingsContextValue;
}

function renderPage(contextValue: SettingsContextValue): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
          <SettingsProvider value={contextValue}>
            <SessionRuntimePage />
          </SettingsProvider>
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    );
  });
  return container;
}

describe('SessionRuntimePage', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it('renders a stale runtime with Pending Changes and affected domains', async () => {
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/runtime-status',
      success: true as const,
      data: { status: staleStatus() },
    }));
    container = renderPage(createContextValue({ request }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-testid="pending-changes-bar"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="runtime-state-value"]')?.textContent).toContain(
      'Stale',
    );
    expect(container!.querySelector('[data-testid="runtime-reload-now-button"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="runtime-apply-after-run-button"]')).toBeTruthy();
  });

  it('renders a fresh runtime without the Pending Changes bar', async () => {
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/runtime-status',
      success: true as const,
      data: { status: liveStatus() },
    }));
    container = renderPage(createContextValue({ request }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-testid="pending-changes-bar"]')).toBeNull();
    expect(container!.querySelector('[data-testid="runtime-fresh-note"]')).toBeTruthy();
  });

  it('reload button issues session/reload-runtime with the session id', async () => {
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/runtime-status',
      success: true as const,
      data: { status: staleStatus() },
    }));
    container = renderPage(createContextValue({ request }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      (
        container!.querySelector('[data-testid="runtime-reload-now-button"]') as HTMLButtonElement
      )?.click();
    });
    const reloadCall = request.mock.calls.find((call) => call[0].type === 'session/reload-runtime');
    expect(reloadCall).toBeTruthy();
    expect(reloadCall?.[0]).toMatchObject({
      sessionId: 's1',
      when: 'now',
    });
  });
});
