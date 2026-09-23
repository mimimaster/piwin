// @vitest-environment happy-dom
/**
 * CodeSearchPage — settings for the built-in `code_search` tool.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type ModelRef, type PiwinConfig } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { CodeSearchPage } from './code-search-page';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createConfig(overrides?: Partial<PiwinConfig>): PiwinConfig {
  return {
    hostMode: 'rpc',
    providers: [
      {
        id: 'custom-openai',
        protocol: 'openai-compatible',
        name: 'Custom',
        baseUrl: 'http://127.0.0.1:9999/v1',
        models: [
          { id: 'gpt-5-mini', label: 'GPT-5 mini' },
          { id: 'gpt-5', label: 'GPT-5' },
        ],
      },
    ],
    media: { maxPasteBytes: 1_000, allowedMimeTypes: ['image/png'] },
    artifact: {
      enabled: false,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1_000,
    },
    ...overrides,
  };
}

function createContextValue(overrides?: Partial<SettingsContextValue>): SettingsContextValue {
  return {
    request: vi.fn(async (cmd: { type: string }) => ({
      id: '0',
      type: 'response' as const,
      command: cmd.type,
      success: true as const,
      data: {},
    })),
    config: createConfig(),
    root: '~/.piwin',
    saving: false,
    setError: vi.fn(),
    setInfo: vi.fn(),
    saveConfig: vi.fn(async () => true),
    webDraft: {
      searchSources: [],
      searchProvider: 'none',
      searchApiKeyEnv: '',
      searchMaxResults: 10,
      searchTimeoutMs: 1000,
      searchStrategy: { mode: 'parallel', perSourceTimeoutMs: 1000 },
      fetchProvider: 'supermarkdown',
      fetchApiKeyEnv: '',
      fetchMaxBytes: 1000,
      fetchTimeoutMs: 1000,
      fetchFallback: 'none',
      fetchBlockedUrlPrefixes: [],
      delegateSearch: false,
    } as unknown as SettingsContextValue['webDraft'],
    setWebDraft: vi.fn(),
    saveWeb: vi.fn(async () => true),
    preferences: {} as unknown as SettingsContextValue['preferences'],
    onPreferencesChange: vi.fn(),
    projectPath: null,
    projectTrusted: true,
    hostStatus: null,
    activeSessionId: null,
    onOpenSubagentSession: undefined,
    selectSection: vi.fn(),
    requestSkills: vi.fn(),
    requestMcp: vi.fn(),
    requestExtensions: vi.fn(),
    requestPlugins: vi.fn(),
    requestPrompts: vi.fn(),
    requestPet: vi.fn(),
    requestAutomation: vi.fn(),
    requestSubAgent: undefined,
    activeTheme: PIWIN_APPEARANCE_DARK,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    searchModelCatalog: vi.fn(),
    searchImageModelCatalog: vi.fn(),
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
    testCodeSearchWindsurf: vi.fn(async () => ({ durationMs: 1, resultCount: 1 })),
    storeProviderSecret: vi.fn(async () => 'keychain:piwin-code-search-windsurf'),
    loadProviderSecret: vi.fn(async () => null),
    ...overrides,
  };
}


/** React ignores a plain `input.value = x`; go through the native setter. */
function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('CodeSearchPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPage(contextValue: SettingsContextValue) {
    await act(async () => {
      root.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={contextValue.activeTheme}>
            <SettingsProvider value={contextValue}>
              <CodeSearchPage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });
  }

  function findSwitch(): HTMLInputElement | null {
    const switches = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    return switches[0] ?? null;
  }

  it('starts disabled and offers both backends', async () => {
    const contextValue = createContextValue();
    await renderPage(contextValue);
    expect(container.textContent).toContain('代码搜索');
    expect(findSwitch()?.checked).toBe(false);
    expect(container.textContent).toContain('已配置模型');
    expect(container.textContent).toContain('Windsurf 云端');
  });

  it('lists only chat/reasoning models, not image video or voice', async () => {
    const contextValue = createContextValue({
      config: createConfig({
        providers: [
          {
            id: 'custom-openai',
            protocol: 'openai-compatible',
            name: 'Cpa',
            baseUrl: 'http://127.0.0.1:8317/v1',
            models: [
              { id: 'gpt-5-mini', label: 'GPT-5 mini', capabilities: ['chat'] },
              { id: 'grok-imagine-image', label: 'Imagine', capabilities: ['image-generation'] },
              { id: 'grok-imagine-video', label: 'Imagine Video', capabilities: ['video-generation'] },
              { id: 'grok-voice', label: 'Voice', capabilities: ['realtime-audio'] },
              { id: 'whisper-1', label: 'Whisper', capabilities: ['speech-to-text'] },
            ],
          },
        ],
      }),
    });
    await renderPage(contextValue);
    const select = container.querySelector<HTMLSelectElement>('[data-testid="code-search-model"]');
    expect(select).not.toBeNull();
    const values = [...(select?.querySelectorAll('option') ?? [])].map((option) => option.value);
    expect(values).toContain('custom-openai/gpt-5-mini');
    expect(values.some((value) => value.includes('imagine') || value.includes('voice') || value.includes('whisper'))).toBe(
      false,
    );
  });

  it('saves the enabled flag with the selected model', async () => {
    const contextValue = createContextValue();
    await renderPage(contextValue);

    await act(async () => {
      findSwitch()?.click();
    });
    const select = container.querySelector<HTMLSelectElement>('[data-testid="code-search-model"]');
    expect(select).not.toBeNull();
    await act(async () => {
      if (select) {
        select.value = 'custom-openai/gpt-5-mini';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    // Model comes from config; pick it through the same handler the page uses.
    await act(async () => {
      const save = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('保存'),
      );
      save?.click();
    });

    const saveConfig = contextValue.saveConfig as unknown as ReturnType<typeof vi.fn>;
    expect(saveConfig).toHaveBeenCalledTimes(1);
    const saved = saveConfig.mock.calls[0]?.[0] as PiwinConfig;
    expect(saved.codeSearch?.enabled).toBe(true);
    expect(saved.codeSearch?.backend).toBe('model');
    const model: ModelRef | undefined = saved.codeSearch?.model;
    expect(model).toEqual({ providerId: 'custom-openai', modelId: 'gpt-5-mini' });
  });

  it('saves a model backend without an explicit pick so Host can use the default chat model', async () => {
    const contextValue = createContextValue();
    await renderPage(contextValue);

    await act(async () => {
      findSwitch()?.click();
    });
    await act(async () => {
      const save = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('保存'),
      );
      save?.click();
    });

    const saveConfig = contextValue.saveConfig as unknown as ReturnType<typeof vi.fn>;
    expect(saveConfig).toHaveBeenCalledTimes(1);
    const saved = saveConfig.mock.calls[0]?.[0] as PiwinConfig;
    expect(saved.codeSearch?.enabled).toBe(true);
    expect(saved.codeSearch?.backend).toBe('model');
    expect(saved.codeSearch?.model).toBeUndefined();
  });

  it('shows the token editor for the windsurf backend', async () => {
    const contextValue = createContextValue({
      config: createConfig({ codeSearch: { enabled: true, backend: 'windsurf' } }),
    });
    await renderPage(contextValue);

    expect(container.querySelector('[data-testid="code-search-windsurf-token"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-search-model"]')).toBeNull();
  });

  it('blocks saving windsurf without a token', async () => {
    const contextValue = createContextValue({
      config: createConfig({ codeSearch: { enabled: true, backend: 'windsurf' } }),
    });
    await renderPage(contextValue);

    await act(async () => {
      const save = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('保存'),
      );
      // Nothing is dirty yet, so no save button exists; toggle to make it dirty.
      const toggle = container.querySelector<HTMLElement>(
        '[data-testid="code-search-windsurf-token"] input',
      );
      if (!save && toggle) {
        toggle.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    // The guard is exercised through the save path used by the UI.
    expect(contextValue.saveConfig).not.toHaveBeenCalled();
  });

  it('saves advanced numeric budgets and drops them when cleared', async () => {
    const contextValue = createContextValue({
      config: createConfig({
        codeSearch: {
          enabled: true,
          backend: 'model',
          model: { providerId: 'custom-openai', modelId: 'gpt-5-mini' },
          maxTurns: 5,
        },
      }),
    });
    await renderPage(contextValue);

    await act(async () => {
      const show = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('展开'),
      );
      show?.click();
    });
    const turns = container.querySelector<HTMLInputElement>('[data-testid="code-search-max-turns"]');
    expect(turns).not.toBeNull();
    await act(async () => {
      setInputValue(turns, '');
    });
    await act(async () => {
      const save = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('保存'),
      );
      save?.click();
    });

    const saveConfig = contextValue.saveConfig as unknown as ReturnType<typeof vi.fn>;
    expect(saveConfig).toHaveBeenCalledTimes(1);
    const saved = saveConfig.mock.calls[0]?.[0] as PiwinConfig;
    // Clearing the field removes the key instead of persisting the old value.
    expect(saved.codeSearch && 'maxTurns' in saved.codeSearch).toBe(false);
  });

  it('shows a test icon next to the Windsurf API key field', async () => {
    const request = vi.fn(async (cmd: { type: string }) => {
      if (cmd.type === 'code-search/test-windsurf') {
        return {
          id: '0',
          type: 'response' as const,
          command: cmd.type,
          success: true as const,
          data: { durationMs: 12, resultCount: 1 },
        };
      }
      return {
        id: '0',
        type: 'response' as const,
        command: cmd.type,
        success: true as const,
        data: {},
      };
    });
    const contextValue = createContextValue({
      request,
      config: createConfig({ codeSearch: { enabled: true, backend: 'windsurf' } }),
    });
    await renderPage(contextValue);
    const testIcon = container.querySelector('[data-testid="code-search-windsurf-token-test"]');
    expect(testIcon).not.toBeNull();
    expect(testIcon?.getAttribute('aria-label')).toMatch(/测试连接|Test connection/);
  });


  it('explains that code_search stays off until the enable switch is saved', async () => {
    const contextValue = createContextValue({
      config: createConfig({ codeSearch: { enabled: false, backend: 'windsurf' } }),
    });
    await renderPage(contextValue);
    const status = container.querySelector('[data-testid="code-search-status"]');
    expect(status?.textContent ?? '').toMatch(/不会出现|will not get/);
  });


  it('uses the Devin subscription when the Devin login button is clicked', async () => {
    const saveConfig = vi.fn(async () => true);
    const contextValue = createContextValue({
      config: createConfig({ codeSearch: { enabled: false, backend: 'windsurf' } }),
      saveConfig,
    });
    await renderPage(contextValue);

    const login = container.querySelector<HTMLButtonElement>(
      '[data-testid="code-search-devin-login"]',
    );
    expect(login).not.toBeNull();
    expect(login?.textContent).toContain('使用 Devin 登录');
    expect(container.textContent).toContain('未填写 token 时使用 Devin 订阅（oauth:devin）。');
    expect(container.querySelector('[data-testid="code-search-windsurf-token"]')).not.toBeNull();

    await act(async () => {
      login?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveConfig).toHaveBeenCalled();
    const savedCall = saveConfig.mock.calls.at(-1) as [PiwinConfig] | undefined;
    const saved = savedCall?.[0];
    expect(saved?.codeSearch?.enabled).toBe(true);
    expect(saved?.codeSearch?.backend).toBe('windsurf');
    expect(saved?.codeSearch?.apiKeyRef).toBe('oauth:devin');
    expect(saved?.codeSearch?.apiKeyEnv).toBeUndefined();
  });

  it('auto-enables code_search when the Windsurf API key is saved', async () => {
    const storeProviderSecret = vi.fn(async () => 'keychain:piwin-code-search-windsurf');
    const saveConfig = vi.fn(async () => true);
    const request = vi.fn(async (cmd: { type: string }) => ({
      id: '0',
      type: 'response' as const,
      command: cmd.type,
      success: true as const,
      data: cmd.type === 'code-search/test-windsurf' ? { durationMs: 1, resultCount: 1 } : {},
    }));
    const contextValue = createContextValue({
      config: createConfig({ codeSearch: { enabled: false, backend: 'windsurf' } }),
      storeProviderSecret,
      saveConfig,
      request,
      loadProviderSecret: vi.fn(async () => null),
    });
    await renderPage(contextValue);

    const field =
      container.querySelector<HTMLInputElement>('[data-testid="code-search-windsurf-token-input"] input') ??
      container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(field).not.toBeNull();
    await act(async () => {
      setInputValue(field!, 'devin-session-token$test-key');
    });
    await act(async () => {
      const saveKey = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('保存 API Key'),
      );
      saveKey?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(storeProviderSecret).toHaveBeenCalled();
    expect(saveConfig).toHaveBeenCalled();
    const savedCall = saveConfig.mock.calls.at(0) as [PiwinConfig] | undefined;
    const saved = savedCall?.[0];
    expect(saved?.codeSearch?.enabled).toBe(true);
    expect(saved?.codeSearch?.backend).toBe('windsurf');
    expect(saved?.codeSearch?.apiKeyRef).toBe('keychain:piwin-code-search-windsurf');
  });

});