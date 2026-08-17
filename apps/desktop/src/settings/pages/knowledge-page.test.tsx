// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWebConfig, type PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { webToDraft } from '../web-draft';
import { KnowledgePage } from './knowledge-page';

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

describe('KnowledgePage settings', () => {
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

  it('saves notes.embedding and knowledge.embedding together', async () => {
    const context = createContextValue(baseConfig());
    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={context}>
              <KnowledgePage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const enable = container!.querySelector<HTMLInputElement>(
      '[data-testid="knowledge-embedding-enabled"] input, [data-testid="knowledge-embedding-enabled"]',
    );
    expect(enable).toBeTruthy();
    act(() => {
      enable!.click();
    });

    const url = container!.querySelector<HTMLInputElement>(
      '[data-testid="knowledge-embedding-base-url"] input, [data-testid="knowledge-embedding-base-url"]',
    );
    const model = container!.querySelector<HTMLInputElement>(
      '[data-testid="knowledge-embedding-model"] input, [data-testid="knowledge-embedding-model"]',
    );
    expect(url).toBeTruthy();
    expect(model).toBeTruthy();
    act(() => {
      setInputValue(url, 'http://127.0.0.1:11434/v1');
      setInputValue(model, 'nomic-embed-text');
    });

    const save = container!.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-embedding-save"]',
    );
    expect(save?.disabled).toBe(false);
    await act(async () => {
      save!.click();
    });

    expect(context.saveConfig).toHaveBeenCalled();
    const saved = (context.saveConfig as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as PiwinConfig;
    expect(saved.notes?.embedding).toMatchObject({
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'nomic-embed-text',
    });
    expect(saved.knowledge?.embedding).toMatchObject({
      enabled: true,
      model: 'nomic-embed-text',
    });
  });

  it('exposes parser, reranker, and generation model controls', () => {
    const context = createContextValue(baseConfig());
    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={context}>
              <KnowledgePage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container!.querySelector('[data-testid="settings-knowledge-parsers"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="knowledge-mineru-enabled"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="settings-knowledge-reranker"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="knowledge-extraction-model"]')).not.toBeNull();
  });
});
