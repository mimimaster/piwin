// @vitest-environment happy-dom
/**
 * SessionPage Walkthrough settings coverage (spec §6.3).
 * Uses the same happy-dom + createRoot + act pattern as plan-card.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createDefaultWalkthroughConfig,
  MAX_WALKTHROUGH_PROMPT_BYTES,
  type ModelProviderConfig,
  type PiwinConfig,
  type WalkthroughConfig,
} from '@piwin/contracts';
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

const PROVIDER_A: ModelProviderConfig = {
  id: 'pa',
  protocol: 'openai-compatible',
  name: 'Provider A',
  baseUrl: 'https://a.example/v1',
  models: [{ id: 'gpt-4o', label: 'GPT-4o' }, { id: 'gpt-mini' }],
};

const PROVIDER_B: ModelProviderConfig = {
  id: 'pb',
  protocol: 'anthropic-compatible',
  name: 'Provider B',
  baseUrl: 'https://b.example',
  models: [{ id: 'claude-3', label: 'Claude 3' }],
};

function baseConfig(overrides: Partial<PiwinConfig> = {}): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [PROVIDER_A, PROVIDER_B],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: { maxBytes: 1024, htmlUiModeDefault: false },
    walkthrough: createDefaultWalkthroughConfig(),
    ...overrides,
  };
}

function createContextValue(
  config: PiwinConfig,
  saveConfig: SettingsContextValue['saveConfig'],
  setInfo: SettingsContextValue['setInfo'],
): SettingsContextValue {
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
    setInfo,
    saveConfig,
    webDraft: webToDraft(createDefaultWebConfig()),
    setWebDraft: vi.fn(),
    saveWeb: vi.fn(async () => undefined),
    preferences: {
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
      toolDensity: 'comfortable',
      workDetailsExpanded: 'auto',
      artifactPreviewEnabled: true,
      artifactCodeFirst: false,
    },
    onPreferencesChange: vi.fn(),
    projectPath: null,
    projectTrusted: false,
    hostStatus: null,
    activeSessionId: null,
    onOpenSubagentSession: undefined,
    selectSection: vi.fn(),
    requestSkills: vi.fn(),
    requestMcp: vi.fn(),
    requestExtensions: vi.fn(),
    requestPrompts: vi.fn(),
    requestTheme: vi.fn(),
    requestPet: vi.fn(),
    requestAutomation: vi.fn(),
    requestSubAgent: undefined,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    storeProviderSecret: vi.fn(),
    loadProviderSecret: vi.fn(),
  };
}

function renderPage(
  config: PiwinConfig,
  saveConfig: SettingsContextValue['saveConfig'] = vi.fn(async () => true),
  setInfo: SettingsContextValue['setInfo'] = vi.fn(),
): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
          <SettingsProvider value={createContextValue(config, saveConfig, setInfo)}>
            <SessionPage />
          </SettingsProvider>
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    );
  });
  return { container, root };
}

function selectValue(container: HTMLElement, testId: string): string {
  const select = container.querySelector<HTMLSelectElement>(`select[data-testid="${testId}"]`);
  if (!select) throw new Error(`select not found for ${testId}`);
  return select.value;
}

function setSelect(container: HTMLElement, testId: string, value: string): void {
  const select = container.querySelector<HTMLSelectElement>(`select[data-testid="${testId}"]`);
  if (!select) throw new Error(`select not found for ${testId}`);
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setTextarea(container: HTMLElement, testId: string, value: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>(
    `[data-testid="${testId}"] textarea`,
  );
  if (!textarea) throw new Error(`textarea not found for ${testId}`);
  // React tracks the last value via an internal value tracker; setting `.value`
  // directly then dispatching `input` does not fire onChange unless we go
  // through the native prototype setter so React sees a real mutation.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    if (setter) {
      setter.call(textarea, value);
    } else {
      textarea.value = value;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function clickSwitch(container: HTMLElement, testId: string): void {
  const input = container.querySelector<HTMLInputElement>(`input[data-testid="${testId}"]`);
  if (!input) throw new Error(`switch input not found for ${testId}`);
  act(() => {
    input.click();
  });
}

function clickButton(container: HTMLElement, testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!button) throw new Error(`button not found for ${testId}`);
  act(() => {
    button.click();
  });
}

describe('SessionPage Walkthrough settings', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders the walkthrough section with enabled switch defaulting to checked', () => {
    const { container, root } = renderPage(baseConfig());
    expect(container.querySelector('[data-testid="walkthrough-section"]')).toBeTruthy();
    const sw = container.querySelector<HTMLInputElement>(
      'input[data-testid="walkthrough-enabled-switch"]',
    );
    expect(sw).toBeTruthy();
    expect(sw?.checked).toBe(true);
    act(() => root.unmount());
  });

  it('toggling the enabled switch updates local state', () => {
    const { container, root } = renderPage(baseConfig());
    clickSwitch(container, 'walkthrough-enabled-switch');
    const sw = container.querySelector<HTMLInputElement>(
      'input[data-testid="walkthrough-enabled-switch"]',
    );
    expect(sw?.checked).toBe(false);
    act(() => root.unmount());
  });

  it('mode select switches between default and custom', () => {
    const { container, root } = renderPage(baseConfig());
    // Collapse keeps children mounted (display:none) so state is preserved
    // across mode toggles. In happy-dom the CSS transition never flushes, so
    // assert visibility via aria-hidden which toggles synchronously.
    const collapse = container.querySelector<HTMLElement>(
      '[data-testid="walkthrough-custom-collapse"]',
    );
    expect(collapse).toBeTruthy();
    expect(collapse?.getAttribute('aria-hidden')).toBe('true');

    setSelect(container, 'walkthrough-mode-select', 'custom');
    const collapseOpen = container.querySelector<HTMLElement>(
      '[data-testid="walkthrough-custom-collapse"]',
    );
    expect(collapseOpen?.getAttribute('aria-hidden')).toBe('false');
    expect(container.querySelector('select[data-testid="walkthrough-model-select"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-prompt-textarea"]')).toBeTruthy();

    // Switching back to default retains the prompt draft (Collapse hides it).
    setTextarea(container, 'walkthrough-prompt-textarea', 'my draft prompt');
    setSelect(container, 'walkthrough-mode-select', 'default');
    const collapseHidden = container.querySelector<HTMLElement>(
      '[data-testid="walkthrough-custom-collapse"]',
    );
    expect(collapseHidden?.getAttribute('aria-hidden')).toBe('true');
    // Re-expand and verify draft persisted.
    setSelect(container, 'walkthrough-mode-select', 'custom');
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="walkthrough-prompt-textarea"] textarea',
    );
    expect(textarea?.value).toBe('my draft prompt');
    act(() => root.unmount());
  });

  it('model select populates from all providers with <name> / <label or id>', () => {
    const { container, root } = renderPage(baseConfig());
    setSelect(container, 'walkthrough-mode-select', 'custom');
    const select = container.querySelector<HTMLSelectElement>(
      'select[data-testid="walkthrough-model-select"]',
    );
    expect(select).toBeTruthy();
    const options = Array.from(select?.options ?? []);
    const labels = options.map((option) => option.textContent);
    expect(labels).toContain('Provider A / GPT-4o');
    expect(labels).toContain('Provider A / gpt-mini');
    expect(labels).toContain('Provider B / Claude 3');
    act(() => root.unmount());
  });

  it('saving a valid custom config persists walkthrough with the selected model and prompt', async () => {
    const saveConfig = vi.fn(async () => true);
    const setInfo = vi.fn();
    const { container, root } = renderPage(baseConfig(), saveConfig, setInfo);

    setSelect(container, 'walkthrough-mode-select', 'custom');
    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-testid="walkthrough-model-select"]',
    );
    const gpt4oValue = Array.from(modelSelect?.options ?? []).find(
      (option) => option.textContent === 'Provider A / GPT-4o',
    )?.value;
    expect(gpt4oValue).toBeTruthy();
    setSelect(container, 'walkthrough-model-select', gpt4oValue ?? '');
    setTextarea(container, 'walkthrough-prompt-textarea', 'Explain the changes');

    // The save handler is async (awaits saveConfig); use an async act so the
    // microtask queue flushes before asserting setInfo was called.
    await act(async () => {
      clickButton(container, 'walkthrough-save-button');
    });
    expect(saveConfig).toHaveBeenCalledTimes(1);
    const savedCalls = saveConfig.mock.calls as unknown as [PiwinConfig][];
    const saved = savedCalls[0]?.[0];
    if (!saved) throw new Error('saveConfig was not called');
    expect(saved.walkthrough?.mode).toBe('custom');
    expect(saved.walkthrough?.custom.prompt).toBe('Explain the changes');
    expect(saved.walkthrough?.custom.model).toEqual({
      protocol: 'openai-compatible',
      providerId: 'pa',
      modelId: 'gpt-4o',
    });
    expect(setInfo).toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('shows a field-level error and blocks save when prompt is empty', () => {
    const saveConfig = vi.fn(async () => true);
    const { container, root } = renderPage(baseConfig(), saveConfig, vi.fn());

    setSelect(container, 'walkthrough-mode-select', 'custom');
    setTextarea(container, 'walkthrough-prompt-textarea', '   ');

    // Save button should be disabled when issues exist.
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-save-button"]',
    );
    expect(button?.disabled).toBe(true);

    // The TextArea surfaces the prompt error.
    const textareaRoot = container.querySelector('[data-testid="walkthrough-prompt-textarea"]');
    expect(textareaRoot?.getAttribute('data-invalid')).toBe('true');
    expect(saveConfig).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('shows a field-level error and blocks save when model is unselected in custom mode', () => {
    const saveConfig = vi.fn(async () => true);
    const { container, root } = renderPage(baseConfig(), saveConfig, vi.fn());

    setSelect(container, 'walkthrough-mode-select', 'custom');
    // Leave model unselected: the draft's modelValue stays '' (no option match),
    // so the resolved model is null even though the native <select> may display
    // the first option visually. Keep the default prompt (valid).
    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-testid="walkthrough-model-select"]',
    );
    expect(modelSelect).toBeTruthy();

    // The model error element should be rendered.
    const modelError = container.querySelector('[data-testid="walkthrough-model-error"]');
    expect(modelError).toBeTruthy();

    // Save button should be disabled when issues exist.
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-save-button"]',
    );
    expect(button?.disabled).toBe(true);
    expect(saveConfig).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('shows a field-level error when prompt exceeds the byte limit', () => {
    const { container, root } = renderPage(baseConfig());
    setSelect(container, 'walkthrough-mode-select', 'custom');
    const over = 'x'.repeat(MAX_WALKTHROUGH_PROMPT_BYTES + 1);
    setTextarea(container, 'walkthrough-prompt-textarea', over);
    const textareaRoot = container.querySelector('[data-testid="walkthrough-prompt-textarea"]');
    expect(textareaRoot?.getAttribute('data-invalid')).toBe('true');
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-save-button"]',
    );
    expect(button?.disabled).toBe(true);
    act(() => root.unmount());
  });

  it('shows a guide message when no models are configured', () => {
    const { container, root } = renderPage(
      baseConfig({
        providers: [],
        walkthrough: { ...createDefaultWalkthroughConfig(), mode: 'custom' },
      }),
    );
    expect(container.querySelector('[data-testid="walkthrough-no-models-guide"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-model-select"]')).toBeNull();
    act(() => root.unmount());
  });

  it('reflects persisted walkthrough config on initial render', () => {
    const persisted: WalkthroughConfig = {
      ...createDefaultWalkthroughConfig(),
      enabled: false,
      mode: 'custom',
      custom: {
        model: {
          protocol: 'anthropic-compatible' as const,
          providerId: 'pb',
          modelId: 'claude-3',
        },
        prompt: 'persisted prompt',
      },
    };
    const { container, root } = renderPage(baseConfig({ walkthrough: persisted }));
    const sw = container.querySelector<HTMLInputElement>(
      'input[data-testid="walkthrough-enabled-switch"]',
    );
    expect(sw?.checked).toBe(false);
    expect(selectValue(container, 'walkthrough-mode-select')).toBe('custom');
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="walkthrough-prompt-textarea"] textarea',
    );
    expect(textarea?.value).toBe('persisted prompt');
    act(() => root.unmount());
  });
});
