// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { CompactionDelegationSettings } from './CompactionDelegationSettings';
import { SettingsProvider, type SettingsContextValue } from './settings-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function baseConfig(compaction?: PiwinConfig['compaction']): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [
      {
        id: 'main-provider',
        protocol: 'openai-compatible',
        name: 'Main AI',
        baseUrl: 'https://main.example/v1',
        models: [{ id: 'main-model', label: 'Main Model', capabilities: ['chat'] }],
      },
      {
        id: 'third-party-summarizer',
        protocol: 'openai-compatible',
        name: 'DeepSeek Third-Party',
        baseUrl: 'https://third.example/v1',
        models: [{ id: 'deepseek-chat', label: 'DeepSeek Chat', capabilities: ['chat'] }],
      },
      {
        id: 'disabled-provider',
        enabled: false,
        protocol: 'openai-compatible',
        name: 'Disabled',
        baseUrl: 'https://disabled.example/v1',
        models: [{ id: 'hidden', label: 'Hidden', capabilities: ['chat'] }],
      },
    ],
    media: { maxPasteBytes: 1_000_000, allowedMimeTypes: ['image/png'] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 100_000,
    },
    skills: { extraPaths: [], disabledIds: [] },
    extensions: { extraPaths: [], disabledIds: [] },
    prompts: { extraPaths: [], disabledIds: [] },
    notes: { enabled: true },
    flashcards: { enabled: true },
    ...(compaction ? { compaction } : {}),
  };
}

function renderSettings(config: PiwinConfig, saveConfig = vi.fn(async () => true)) {
  const setInfo = vi.fn();
  const setError = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const contextValue = {
    config,
    saveConfig,
    setInfo,
    setError,
  } as unknown as SettingsContextValue;

  act(() => {
    root?.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <SettingsProvider value={contextValue}>
            <CompactionDelegationSettings />
          </SettingsProvider>
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    );
  });

  return { container, saveConfig, setInfo, setError };
}

describe('CompactionDelegationSettings', () => {
  it('enables delegation, requires selecting a model before save, and persists the third-party model', async () => {
    const saveConfig = vi.fn(async () => true);
    const { container: view, setInfo } = renderSettings(baseConfig(), saveConfig);

    const toggle = view.querySelector<HTMLInputElement>(
      'input[data-testid="compaction-delegation-enabled"]',
    );
    const select = view.querySelector<HTMLSelectElement>(
      'select[data-testid="compaction-delegation-model"]',
    );
    const saveButton = view.querySelector<HTMLButtonElement>(
      'button[data-testid="compaction-delegation-save"]',
    );

    expect(toggle).not.toBeNull();
    expect(select).not.toBeNull();
    expect(saveButton).not.toBeNull();

    const optionTexts = Array.from(select!.options).map((opt) => opt.textContent ?? '');
    expect(optionTexts.some((text) => text.includes('DeepSeek Third-Party'))).toBe(true);
    expect(optionTexts.some((text) => text.includes('Hidden'))).toBe(false);

    expect(saveButton!.disabled).toBe(true);

    // Toggle switch ON without picking a model: save stays disabled and warning appears.
    act(() => {
      toggle!.click();
    });
    expect(
      view.querySelector('[data-testid="compaction-delegation-missing-model"]'),
    ).not.toBeNull();
    expect(saveButton!.disabled).toBe(true);

    // Pick the third-party chat model and click Save.
    const delegateOption = Array.from(select!.options).find((opt) =>
      opt.value.includes('third-party-summarizer\u0000deepseek-chat'),
    );
    expect(delegateOption).toBeDefined();

    await act(async () => {
      select!.value = delegateOption!.value;
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(
      view.querySelector('[data-testid="compaction-delegation-missing-model"]'),
    ).toBeNull();
    expect(saveButton!.disabled).toBe(false);

    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });

    expect(saveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = (saveConfig.mock.calls[0] as unknown as [PiwinConfig])[0];
    expect(savedConfig.compaction?.delegation).toEqual({
      enabled: true,
      model: {
        protocol: 'openai-compatible',
        providerId: 'third-party-summarizer',
        modelId: 'deepseek-chat',
      },
    });
    expect(setInfo).toHaveBeenCalledWith('已保存压缩委托设置。');
  });

  it('preserves the saved model when delegation is toggled off and saved', async () => {
    const delegateModel = {
      protocol: 'openai-compatible' as const,
      providerId: 'third-party-summarizer',
      modelId: 'deepseek-chat',
    };
    const saveConfig = vi.fn(async () => true);
    const { container: view } = renderSettings(
      baseConfig({
        autoEnabledDefault: true,
        delegation: { enabled: true, model: delegateModel },
      }),
      saveConfig,
    );

    const toggle = view.querySelector<HTMLInputElement>(
      'input[data-testid="compaction-delegation-enabled"]',
    );
    const saveButton = view.querySelector<HTMLButtonElement>(
      'button[data-testid="compaction-delegation-save"]',
    );

    expect(toggle!.checked).toBe(true);

    act(() => {
      toggle!.click();
    });
    expect(toggle!.checked).toBe(false);
    expect(saveButton!.disabled).toBe(false);

    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });

    const savedConfig = (saveConfig.mock.calls[0] as unknown as [PiwinConfig])[0];
    expect(savedConfig.compaction?.delegation).toEqual({
      enabled: false,
      model: delegateModel,
    });
  });

  it('shows a non-blocking warning when the saved delegated provider is disabled', () => {
    const { container: view } = renderSettings(
      baseConfig({
        autoEnabledDefault: true,
        delegation: {
          enabled: true,
          model: {
            protocol: 'openai-compatible',
            providerId: 'disabled-provider',
            modelId: 'hidden',
          },
        },
      }),
    );

    expect(
      view.querySelector('[data-testid="compaction-delegation-unavailable-warning"]'),
    ).not.toBeNull();
  });
});
