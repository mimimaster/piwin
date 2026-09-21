// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWebConfig, type PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens.js';
import { DesktopLocaleProvider } from '../../desktop-locale-context.js';
import { SettingsProvider, type SettingsContextValue } from '../settings-context.js';
import { webToDraft } from '../web-draft.js';
import { KnowledgePage } from './knowledge-page.js';

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
    storeProviderSecret: vi.fn(async () => 'keychain:notes-embedding-123'),
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

  it('saves notes.embedding and knowledge.embedding together without separate API key button', async () => {
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
    const apiKey = container!.querySelector<HTMLInputElement>(
      '[data-testid="knowledge-embedding-api-key"] input, [data-testid="knowledge-embedding-api-key"]',
    );
    expect(url).toBeTruthy();
    expect(model).toBeTruthy();
    expect(apiKey).toBeTruthy();

    act(() => {
      setInputValue(url, 'https://api.openai.com/v1');
      setInputValue(model, 'text-embedding-3-small');
      setInputValue(apiKey, 'sk-test-secret-key');
    });

    // Ensure there is NO separate "Save API Key" button
    const buttons = Array.from(container!.querySelectorAll('button'));
    const saveApiKeyBtn = buttons.find((b) => b.textContent?.includes('Save API Key') || b.textContent?.includes('保存 API Key'));
    expect(saveApiKeyBtn).toBeUndefined();

    // The single unified save button
    const save = container!.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-embedding-save"]',
    );
    expect(save?.disabled).toBe(false);
    await act(async () => {
      save!.click();
    });

    expect(context.storeProviderSecret).toHaveBeenCalledWith('notes-embedding', 'sk-test-secret-key');
    expect(context.saveConfig).toHaveBeenCalled();
    const saved = (context.saveConfig as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as PiwinConfig;
    expect(saved.notes?.embedding).toMatchObject({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      apiKeyRef: 'keychain:notes-embedding-123',
    });
    expect(saved.knowledge?.embedding).toMatchObject({
      enabled: true,
      model: 'text-embedding-3-small',
      apiKeyRef: 'keychain:notes-embedding-123',
    });
  });

  it('renders test connection button in enabled embedding tab', async () => {
    const configWithEmbedding: PiwinConfig = {
      ...baseConfig(),
      knowledge: {
        embedding: {
          enabled: true,
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'text-embedding-3-small',
        },
      },
    };
    const context = createContextValue(configWithEmbedding);

    act(() => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SettingsProvider value={context}>
              <KnowledgePage />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const testBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-embedding-test-btn"]',
    );
    expect(testBtn).not.toBeNull();
    expect(testBtn?.textContent).toContain('测试连接');
  });

  it('shows MinerU Base URL and API key after the parser is enabled', async () => {
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

    expect(container!.querySelector('[data-testid="knowledge-mineru-base-url"]')).toBeNull();
    const enable = container!.querySelector<HTMLInputElement>(
      '[data-testid="knowledge-mineru-enabled"] input, [data-testid="knowledge-mineru-enabled"]',
    );
    expect(enable).toBeTruthy();
    act(() => {
      enable!.click();
    });

    const url = container!.querySelector<HTMLInputElement>(
      '[data-testid="knowledge-mineru-base-url"] input, [data-testid="knowledge-mineru-base-url"]',
    );
    const apiKey = container!.querySelector<HTMLInputElement>(
      '[data-testid="knowledge-mineru-api-key"] input, [data-testid="knowledge-mineru-api-key"]',
    );
    expect(url).toBeTruthy();
    expect(apiKey).toBeTruthy();
    const testBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-mineru-test-btn"]',
    );
    expect(testBtn).not.toBeNull();
    expect(testBtn?.textContent).toContain('Test connection');
    expect(
      container!.querySelector('.knowledge-tab-panel-header [data-testid="knowledge-mineru-test-btn"]'),
    ).not.toBeNull();

    const save = container!.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-embedding-save"]',
    );
    expect(save?.disabled).toBe(true);

    act(() => {
      setInputValue(url, 'http://127.0.0.1:8000');
      setInputValue(apiKey, 'mineru-token');
    });
    expect(save?.disabled).toBe(false);
    await act(async () => {
      save!.click();
    });

    expect(context.storeProviderSecret).toHaveBeenCalledWith('knowledge-mineru', 'mineru-token');
    const saved = (context.saveConfig as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as PiwinConfig;
    expect(saved.knowledge?.parser?.mineru).toMatchObject({
      enabled: true,
      mode: 'http',
      baseUrl: 'http://127.0.0.1:8000',
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
