// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWalkthroughConfig, type PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { SessionColdStoragePage } from './session-cold-storage-page';
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
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1024,
    },
    walkthrough: createDefaultWalkthroughConfig(),
  };
}

function createContextValue(config: PiwinConfig): SettingsContextValue {
  return {
    request: vi.fn(async (command) => ({
      type: 'response' as const,
      command: command.type,
      success: true as const,
      data:
        command.type === 'session/cold-storage-plan'
          ? {
              planId: 'cold-1',
              confirmationDigest: 'digest-1',
              generatedAt: '2026-08-13T00:00:00.000Z',
              expiresAt: '2026-08-13T00:10:00.000Z',
              action: 'offload',
              packOutputDir: '/tmp/packs',
              estimatedPeakBytes: 10,
              targets: [
                {
                  sessionId: 'ses_1',
                  estimatedPayloadBytes: 10,
                  transcriptSha256: 'aaa',
                },
              ],
              skipped: [],
            }
          : {},
    })),
    config,
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
    activeSessionId: null,
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
    requestPlugins: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestPrompts: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
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
    getModelCatalogStatus: vi.fn(async () => ({
      source: 'pi-bootstrap' as const,
      catalogVersion: 'test',
      entryCount: 0,
      imageEntryCount: 0,
    })),
    syncModelCatalog: vi.fn(async () => ({
      ok: true as const,
      source: 'models.dev' as const,
      catalogVersion: 'test',
      fetchedAt: '2026-09-21T00:00:00.000Z',
      entryCount: 1,
      imageEntryCount: 0,
    })),
    storeProviderSecret: vi.fn(async () => 'ref'),
    loadProviderSecret: vi.fn(async () => null),
  } as unknown as SettingsContextValue;
}

describe('SessionColdStoragePage', () => {
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

  it('keeps execute disabled until saved config and a plan digest exist', async () => {
    const contextValue = createContextValue(baseConfig());
    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <SessionColdStoragePage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    const execute = container!.querySelector<HTMLButtonElement>(
      '[data-testid="cold-storage-execute-button"]',
    );
    expect(execute?.disabled).toBe(true);

    const savedConfig = baseConfig();
    savedConfig.session = {
      coldStorage: {
        enabled: true,
        packOutputDir: '/tmp/packs',
        minArchivedAgeDays: 30,
      },
    };
    const savedContext = createContextValue(savedConfig);
    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={savedContext}>
              <SessionColdStoragePage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    expect(
      container!.querySelector<HTMLButtonElement>('[data-testid="cold-storage-execute-button"]')
        ?.disabled,
    ).toBe(true);

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="cold-storage-plan-button"]')?.click();
      await Promise.resolve();
    });
    expect(savedContext.request).toHaveBeenCalledWith({ type: 'session/cold-storage-plan' });
    expect(
      container!.querySelector<HTMLButtonElement>('[data-testid="cold-storage-execute-button"]')
        ?.disabled,
    ).toBe(false);
  });
});
