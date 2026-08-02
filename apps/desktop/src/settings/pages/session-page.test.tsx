// @vitest-environment happy-dom
/**
 * SessionPage — prompt-only walkthrough settings (ADR 0026).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWalkthroughConfig, type PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { SessionPage } from './session-page';
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
    walkthrough: createDefaultWalkthroughConfig(),
  };
}

function createContextValue(config: PiwinConfig): SettingsContextValue {
  return {
    request: vi.fn(async () => ({
      type: 'response' as const,
      command: 'test',
      success: true as const,
      data: {},
    })),
    config,
    root: '~/.piwin',
    saving: false,
    setError: vi.fn(),
    setInfo: vi.fn(),
    saveConfig: vi.fn(async () => true),
    webDraft: webToDraft(createDefaultWebConfig()),
    setWebDraft: vi.fn(),
    saveWeb: vi.fn(async () => undefined),
    preferences: { assistantTextSize: 'default', codeTextSize: 'default', codeWrap: false },
    onPreferencesChange: vi.fn(),
    projectPath: null,
    projectTrusted: false,
    hostStatus: null,
    activeSessionId: null,
    onOpenSubagentSession: undefined,
    selectSection: vi.fn(),
    requestSkills: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestMcp: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestExtensions: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestPlugins: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestPrompts: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestTheme: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestPet: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestAutomation: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestSubAgent: undefined,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(async () => ({ models: [] })),
    testProviderModel: vi.fn(async () => ({ durationMs: 1 })),
    searchModelCatalog: vi.fn(async () => ({ items: [] })),
    storeProviderSecret: vi.fn(async () => 'ref'),
    loadProviderSecret: vi.fn(async () => null),
  } as unknown as SettingsContextValue;
}

describe('SessionPage ADR 0026 prompt-only', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it('shows enable switch and prompt editor, not auto/model/mode', () => {
    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={createContextValue(baseConfig())}>
              <SessionPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container!.querySelector('[data-testid="walkthrough-enabled-switch"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="walkthrough-prompt-textarea"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="walkthrough-auto-generate-switch"]')).toBeNull();
    expect(container!.querySelector('[data-testid="walkthrough-mode-select"]')).toBeNull();
    expect(container!.querySelector('[data-testid="walkthrough-retired-notice"]')).toBeNull();
  });
});
