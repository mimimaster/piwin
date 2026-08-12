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
import { chooseSessionExportPath } from '../../session-export-dialog';

vi.mock('../../session-export-dialog', () => ({
  chooseSessionExportPath: vi.fn(async () => undefined),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
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
  } as unknown as SettingsContextValue;
}

describe('SessionPage settings', () => {
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

  it('defaults custom prompt on and shows the prompt editor', () => {
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
    const enableSwitch = container!.querySelector<HTMLButtonElement | HTMLInputElement>(
      '[data-testid="walkthrough-enabled-switch"]',
    );
    expect(enableSwitch).toBeTruthy();
    // Default config has enabled: true → prompt editor is visible.
    expect(container!.querySelector('[data-testid="walkthrough-prompt-textarea"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="walkthrough-auto-generate-switch"]')).toBeNull();
    expect(container!.querySelector('[data-testid="walkthrough-mode-select"]')).toBeNull();
    expect(container!.querySelector('[data-testid="walkthrough-retired-notice"]')).toBeNull();
  });

  it('hides the prompt editor when custom prompt is turned off', () => {
    const config = baseConfig();
    config.walkthrough = {
      ...createDefaultWalkthroughConfig(),
      enabled: false,
    };
    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={createContextValue(config)}>
              <SessionPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container!.querySelector('[data-testid="walkthrough-enabled-switch"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="walkthrough-prompt-textarea"]')).toBeNull();
    expect(container!.querySelector('[data-testid="walkthrough-save-button"]')).toBeNull();
  });

  it('offers compact-summary export for the active session', async () => {
    const request = vi.fn(async (command: Parameters<SettingsContextValue['request']>[0]) => ({
      type: 'response' as const,
      command: command.type,
      success: true as const,
      data: { path: '/tmp/compact.md', byteLength: 128 },
    }));
    const contextValue = createContextValue(baseConfig());
    contextValue.request = request;
    contextValue.activeSessionId = 'session-1';
    contextValue.hostStatus = {
      mode: 'sdk',
      ready: true,
      mock: true,
      piwinRoot: '~/.piwin',
      activeSessionIds: ['session-1'],
      capabilities: {
        customTools: true,
        mcpLifecycle: true,
        productTranscript: true,
        compaction: true,
        extensions: true,
        prompts: true,
        sessionExport: true,
      },
    };
    vi.mocked(chooseSessionExportPath).mockResolvedValue('/tmp/compact.md');

    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <SessionPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const button = container!.querySelector<HTMLButtonElement>(
      '[data-testid="session-compact-export-button"]',
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalledWith({
      type: 'session/compact-export',
      sessionId: 'session-1',
      outputPath: '/tmp/compact.md',
    });
    expect(contextValue.setInfo).toHaveBeenCalledWith(
      'Compressed summary exported to /tmp/compact.md (128 bytes).',
      'success',
    );
  });

  it('saves archive policy, previews candidates, and applies the plan', async () => {
    const request = vi.fn(async (command: Parameters<SettingsContextValue['request']>[0]) => {
      if (command.type === 'session/lifecycle-plan') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: {
            planId: 'plan-abc123',
            generatedAt: '2026-08-13T00:00:00.000Z',
            policy: { maxActiveMainSessions: 1 },
            candidates: [
              {
                sessionId: 'old-session',
                name: 'Old session',
                updatedAt: '2026-08-01T00:00:00.000Z',
                reason: 'active-limit',
              },
            ],
            skippedPinned: 0,
            skippedNonMain: 0,
          },
        };
      }
      if (command.type === 'session/lifecycle-apply') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: {
            planId: command.planId,
            appliedAt: '2026-08-13T00:00:00.000Z',
            archived: ['old-session'],
            skipped: [],
            failed: [],
          },
        };
      }
      throw new Error(`unexpected command: ${command.type}`);
    });
    const contextValue = createContextValue(baseConfig());
    contextValue.request = request;
    contextValue.hostStatus = {
      mode: 'sdk',
      ready: true,
      mock: true,
      piwinRoot: '~/.piwin',
      activeSessionIds: [],
      capabilities: {
        customTools: true,
        mcpLifecycle: true,
        productTranscript: true,
        compaction: true,
        extensions: true,
        prompts: true,
        sessionExport: true,
        sessionLifecycle: true,
      },
    };

    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <SessionPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const maxActiveInput = container!.querySelector<HTMLInputElement>(
      '[data-testid="session-lifecycle-max-active-main"]',
    );
    expect(maxActiveInput).not.toBeNull();

    await act(async () => {
      setInputValue(maxActiveInput, '1');
      await Promise.resolve();
    });

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="session-lifecycle-save-button"]')
        ?.click();
      await Promise.resolve();
    });
    expect(contextValue.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          lifecycle: { archive: { maxActiveMainSessions: 1 } },
        }),
      }),
    );

    // The saved config must propagate before plan/apply buttons enable.
    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider
              value={{
                ...contextValue,
                config: {
                  ...baseConfig(),
                  session: { lifecycle: { archive: { maxActiveMainSessions: 1 } } },
                },
              }}
            >
              <SessionPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="session-lifecycle-plan-button"]')
        ?.click();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith({ type: 'session/lifecycle-plan' });
    expect(
      container!.querySelector('[data-testid="session-lifecycle-plan-candidates"]'),
    ).not.toBeNull();

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="session-lifecycle-apply-button"]')
        ?.click();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith({
      type: 'session/lifecycle-apply',
      planId: 'plan-abc123',
    });
    expect(
      container!.querySelector('[data-testid="session-lifecycle-apply-result"]'),
    ).not.toBeNull();
  });

  it('blocks planning while the archive policy draft is unsaved', async () => {
    const contextValue = createContextValue(baseConfig());
    contextValue.hostStatus = {
      mode: 'sdk',
      ready: true,
      mock: true,
      piwinRoot: '~/.piwin',
      activeSessionIds: [],
      capabilities: {
        customTools: true,
        mcpLifecycle: true,
        productTranscript: true,
        compaction: true,
        extensions: true,
        prompts: true,
        sessionLifecycle: true,
      },
    };
    contextValue.setInfo = vi.fn();

    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <SessionPage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const maxInactiveInput = container!.querySelector<HTMLInputElement>(
      '[data-testid="session-lifecycle-max-inactive-days"]',
    );
    await act(async () => {
      setInputValue(maxInactiveInput, '30');
      await Promise.resolve();
    });

    // Draft differs from the saved (empty) policy → plan button disabled.
    expect(
      container!.querySelector<HTMLButtonElement>('[data-testid="session-lifecycle-plan-button"]')
        ?.disabled,
    ).toBe(true);
  });
});
