/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { ModelCatalogEntry, ModelProviderConfig } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ModelWorkbench } from './ModelWorkbench';
import { ModelEditInline } from './model-edit-inline.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function query<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function input(testId: string): HTMLInputElement {
  const element = query<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`Missing input with data-testid="${testId}"`);
  }
  return element;
}

function click(selector: string): void {
  const element = query<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Missing click target: ${selector}`);
  }
  act(() => {
    element.click();
  });
}

function select(selector: string, value: string): void {
  const element = query<HTMLSelectElement>(selector);
  if (!element) {
    throw new Error(`Missing select target: ${selector}`);
  }
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value',
    )?.set;
    valueSetter?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function waitFor(condition: () => boolean, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check(): void {
      try {
        if (condition()) {
          resolve();
          return;
        }
      } catch {
        // Retry until timeout.
      }
      if (Date.now() - start > timeout) {
        reject(new Error('waitFor timeout'));
        return;
      }
      setTimeout(check, 10);
    }
    check();
  });
}

let previousActEnvironment: boolean | undefined;
let instances: { container: HTMLDivElement; root: Root }[] = [];

beforeEach(() => {
  previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  instances = [];
});

afterEach(() => {
  for (const { container, root } of instances) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

function render(node: ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  instances.push({ container, root });
  return { container, root };
}

describe('ModelEditInline', () => {
  it('renders native search capability controls', () => {
    const onSave = vi.fn();
    render(
      <ModelEditInline
        model={{
          id: 'search-model',
          capabilities: ['native-web-search'],
        }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    const checkbox = query<HTMLInputElement>('[data-testid="model-edit-native-web-search"]');
    expect(checkbox?.checked).toBe(true);
    expect(query('[data-testid="model-edit-native-web-search-mode"]')).toBeNull();

    click('[data-testid="model-edit-save"]');
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        supportsNativeWebSearch: true,
      }),
    );
  });

  it('renders only the native search capability checkbox', () => {
    render(
      <ModelEditInline
        model={{ id: 'text-model' }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(query('[data-testid="model-edit-native-web-search"]')).not.toBeNull();
    expect(query('[data-testid="model-edit-native-web-search-mode"]')).toBeNull();
  });

  it('edits the video-generation capability used by Video settings', () => {
    const onSave = vi.fn();
    render(
      <ModelEditInline
        model={{ id: 'custom-async-video' }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    const checkbox = query<HTMLInputElement>('[data-testid="model-edit-video-generation"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(false);
    expect(checkbox?.parentElement?.textContent).toContain('视频');

    click('[data-testid="model-edit-video-generation"]');
    expect(query('[data-testid="model-edit-video-route"]')).not.toBeNull();
    expect(query<HTMLSelectElement>('[data-testid="model-edit-video-api-style"]')?.value).toBe(
      'openai-videos',
    );
    expect(input('model-edit-video-path').value).toBe('/videos');
    click('[data-testid="model-edit-save"]');
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        supportsVideoGeneration: true,
        videoApiStyle: 'openai-videos',
        videoPath: '/videos',
      }),
    );
  });

  it('pre-checks image generation instead of reasoning for Grok Imagine image ids', () => {
    render(
      <ModelEditInline
        model={{ id: 'grok-imagine-image-lite' }}
        providerProtocol="anthropic-compatible"
        disabled={false}
        isChinese
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(input('model-edit-image-generation').checked).toBe(true);
    expect(input('model-edit-reasoning').checked).toBe(false);
    expect(input('model-edit-video-generation').checked).toBe(false);
    expect(query<HTMLSelectElement>('[data-testid="model-edit-image-api-style"]')?.value).toBe(
      'openai',
    );
    expect(input('model-edit-image-path').value).toBe('/images/generations');
  });

  it('fills xGrok video protocol for grok-imagine-video on an Anthropic channel', () => {
    const onSave = vi.fn();
    render(
      <ModelEditInline
        model={{ id: 'grok-imagine-video' }}
        providerProtocol="anthropic-compatible"
        disabled={false}
        isChinese
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    expect(input('model-edit-video-generation').checked).toBe(true);
    expect(query<HTMLSelectElement>('[data-testid="model-edit-video-api-style"]')?.value).toBe(
      'xgrok-videos',
    );
    expect(input('model-edit-video-path').value).toBe('/videos/generations');
    click('[data-testid="model-edit-save"]');
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        supportsVideoGeneration: true,
        videoApiStyle: 'xgrok-videos',
        videoPath: '/videos/generations',
      }),
    );
  });

  it('shows the native search badge in the model workbench row', () => {
    const provider: ModelProviderConfig = {
      id: 'search-provider',
      name: 'Search Provider',
      protocol: 'openai-compatible',
      baseUrl: 'https://provider.example/v1',
      models: [{ id: 'search-model', capabilities: ['native-web-search'] }],
    };
    render(
      <ModelWorkbench
        provider={provider}
        disabled={false}
        defaultModelId={null}
        onModelsChange={vi.fn()}
        onSetDefaultModel={vi.fn()}
        onDiscoverModels={vi.fn(async () => ({
          providerId: 'search-provider',
          protocol: 'openai-compatible' as const,
          models: [],
        }))}
        onTestModel={vi.fn(async () => ({ durationMs: 0 }))}
      />,
    );

    expect(query('[data-testid="model-pill-native-search-search-model"]')).not.toBeNull();
  });

  it('renders inline with all fields visible (no popover trigger needed)', () => {
    render(
      <ModelEditInline
        model={{ id: 'gpt-test' }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(query('[data-testid="model-edit-inline"]')).not.toBeNull();
    expect(query('[data-testid="model-edit-label"]')).not.toBeNull();
    expect(query('[data-testid="model-edit-context"]')).not.toBeNull();
    expect(query('[data-testid="model-edit-output"]')).not.toBeNull();
  });

  it('hydrates missing limits and vision defaults from the exact catalog entry', async () => {
    const catalog: ModelCatalogEntry[] = [
      {
        catalogProviderId: 'openai',
        modelId: 'gpt-test',
        name: 'GPT Test',
        input: ['text', 'image'],
        reasoning: true,
        contextWindow: 200_000,
        maxTokens: 32_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ];
    const searchCatalog = vi.fn(async () => catalog);
    render(
      <ModelEditInline
        model={{ id: 'gpt-test' }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        searchCatalog={searchCatalog}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => input('model-edit-context').value === '200000');
    expect(input('model-edit-output').value).toBe('32000');
    expect(query<HTMLInputElement>('[data-testid="model-edit-supports-image"]')?.checked).toBe(
      true,
    );
  });

  it('shows thinking effort chips when reasoning is enabled and saves with selected levels', () => {
    const onSave = vi.fn();
    render(
      <ModelEditInline
        model={{
          id: 'claude-max',
          reasoning: true,
          thinkingLevels: ['off', 'low', 'medium', 'high'],
        }}
        providerProtocol="anthropic-compatible"
        disabled={false}
        isChinese={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    // Thinking chips should be visible since reasoning is enabled.
    expect(query('[data-testid="model-edit-thinking-chips"]')).not.toBeNull();
    // 'max' level chip should exist but not be active.
    const maxChip = query<HTMLButtonElement>('[data-testid="model-edit-thinking-level-max"]');
    expect(maxChip).not.toBeNull();
    expect(maxChip?.className).not.toContain('is-active');
    // Click to enable 'max'.
    click('[data-testid="model-edit-thinking-level-max"]');
    select('[data-testid="model-edit-thinking-default"]', 'max');
    click('[data-testid="model-edit-save"]');
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
        thinkingLevel: 'max',
      }),
    );
  });

  it('automatically selects and saves a sensible default thinking level without touching the dropdown', () => {
    const onSave = vi.fn();
    render(
      <ModelEditInline
        model={{
          id: 'gpt-4o',
          reasoning: true,
        }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const selectEl = query<HTMLSelectElement>('[data-testid="model-edit-thinking-default"]');
    expect(selectEl?.value).toBe('medium');
    click('[data-testid="model-edit-save"]');
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
        thinkingLevel: 'medium',
      }),
    );
  });

  it('hides thinking effort section when reasoning is disabled', () => {
    render(
      <ModelEditInline
        model={{ id: 'gpt-mini', reasoning: false }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(query('[data-testid="model-edit-thinking-chips"]')).toBeNull();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <ModelEditInline
        model={{ id: 'gpt-test' }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    );
    click('[data-testid="model-edit-cancel"]');
    expect(onCancel).toHaveBeenCalled();
  });

  it('updates context window and output tokens and saves', () => {
    const onSave = vi.fn();
    render(
      <ModelEditInline
        model={{ id: 'gpt-test', contextWindow: 128000, maxOutputTokens: 8192 }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const ctxInput = input('model-edit-context');
    const outInput = input('model-edit-output');
    act(() => {
      setInputValue(ctxInput, '256000');
      setInputValue(outInput, '16000');
    });
    click('[data-testid="model-edit-save"]');
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        contextWindow: '256000',
        maxOutputTokens: '16000',
      }),
    );
  });

  it('does not auto-save a parameter change without clicking save', async () => {
    const onSave = vi.fn();
    render(
      <ModelEditInline
        model={{ id: 'gpt-test', contextWindow: 128000 }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    act(() => {
      setInputValue(input('model-edit-context'), '256000');
    });
    // Wait to verify that no debounce timer triggers auto-save.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    expect(onSave).not.toHaveBeenCalled();

    click('[data-testid="model-edit-save"]');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ contextWindow: '256000' }));
  });

  it('does not save an invalid value and reports validation error on manual save', () => {
    const onSave = vi.fn();
    render(
      <ModelEditInline
        model={{ id: 'gpt-test' }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    act(() => {
      setInputValue(input('model-edit-context'), 'not-a-number');
    });

    click('[data-testid="model-edit-save"]');
    expect(onSave).not.toHaveBeenCalled();
    expect(query('[data-testid="model-edit-error"]')).not.toBeNull();
  });

  it('does not save on unmount when save was not clicked', () => {
    const onSave = vi.fn();
    const { root } = render(
      <ModelEditInline
        model={{ id: 'gpt-test' }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    act(() => {
      setInputValue(input('model-edit-context'), '256000');
    });
    act(() => {
      root.unmount();
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});
