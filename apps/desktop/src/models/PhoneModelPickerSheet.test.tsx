// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import {
  PhoneModelPickerSheet,
  type PhoneModelPickerSheetProps,
  formatInlineThinkingLabel,
  parseModelVendorAndName,
} from './PhoneModelPickerSheet.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('formatInlineThinkingLabel', () => {
  it('formats compact english pills correctly', () => {
    expect(formatInlineThinkingLabel('off', false)).toBe('Off');
    expect(formatInlineThinkingLabel('minimal', false)).toBe('Min');
    expect(formatInlineThinkingLabel('low', false)).toBe('Low');
    expect(formatInlineThinkingLabel('medium', false)).toBe('Med');
    expect(formatInlineThinkingLabel('high', false)).toBe('High');
    expect(formatInlineThinkingLabel('xhigh', false)).toBe('xHigh');
    expect(formatInlineThinkingLabel('max', false)).toBe('Max');
    expect(formatInlineThinkingLabel('ultra', false)).toBe('Ultra');
  });

  it('formats chinese pills correctly', () => {
    expect(formatInlineThinkingLabel('off', true)).toBe('关');
    expect(formatInlineThinkingLabel('minimal', true)).toBe('极低');
    expect(formatInlineThinkingLabel('low', true)).toBe('低');
    expect(formatInlineThinkingLabel('medium', true)).toBe('中');
    expect(formatInlineThinkingLabel('high', true)).toBe('高');
    expect(formatInlineThinkingLabel('xhigh', true)).toBe('极高');
    expect(formatInlineThinkingLabel('max', true)).toBe('最大');
    expect(formatInlineThinkingLabel('ultra', true)).toBe('极致');
  });
});

describe('parseModelVendorAndName', () => {
  it('splits slash names', () => {
    expect(parseModelVendorAndName({ key: '1', label: 'Google / Gemini Pro' })).toEqual({
      vendor: 'Google',
      name: 'Gemini Pro',
    });
  });

  it('prefers providerName over slash prefix', () => {
    expect(
      parseModelVendorAndName({
        key: '1',
        label: 'OpenRouter / gpt-4',
        providerName: 'OpenAI',
      }),
    ).toEqual({
      vendor: 'OpenAI',
      name: 'gpt-4',
    });
  });
});

describe('PhoneModelPickerSheet', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const testModels = [
    {
      key: 'openai:o4-mini',
      label: 'OpenAI / o4-mini',
      providerId: 'openai',
      providerName: 'OpenAI',
      thinkingLevels: ['low', 'medium', 'high', 'xhigh'] as const,
      reasoning: true,
    },
    {
      key: 'anthropic:claude-sonnet',
      label: 'Anthropic / Claude Sonnet',
      providerId: 'anthropic',
      providerName: 'Anthropic',
      thinkingLevels: ['low', 'medium', 'high', 'max'] as const,
      reasoning: true,
    },
    {
      key: 'google:gemini-pro',
      label: 'Google / Gemini Pro',
      providerId: 'google',
      providerName: 'Google',
      thinkingLevels: ['minimal', 'low', 'medium'] as const,
      reasoning: true,
    },
  ];

  function render(props: Partial<PhoneModelPickerSheetProps> = {}): void {
    const fullProps: PhoneModelPickerSheetProps = {
      models: testModels,
      selectedModelKey: 'openai:o4-mini',
      currentEffort: 'xhigh',
      ultraEnabled: false,
      disabled: false,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      ...props,
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PhoneModelPickerSheet {...fullProps} />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders Recent tab by default and does NOT contain the removed hint text', () => {
    render();
    const sheet = document.querySelector('[data-testid="phone-model-picker-sheet"]');
    expect(sheet).not.toBeNull();
    // Verify no "点档位直接切换" or "Tap effort"
    expect(sheet?.textContent).not.toContain('点档位直接切换');
    expect(sheet?.textContent).not.toContain('Tap effort to switch');
    // Verify no star svg/button icons
    expect(sheet?.querySelector('[aria-label="Favorite"]')).toBeNull();
  });

  it('groups models by vendor in All Models and collapses all vendors except current by default', () => {
    render();
    const allTab = document.querySelector<HTMLButtonElement>('[data-testid="phone-model-tab-all"]');
    act(() => {
      allTab?.click();
    });

    const openaiHeader = document.querySelector('[data-testid="phone-vendor-header-OpenAI"]');
    const anthropicHeader = document.querySelector('[data-testid="phone-vendor-header-Anthropic"]');
    expect(openaiHeader).not.toBeNull();
    expect(anthropicHeader).not.toBeNull();

    // OpenAI is the active model vendor, so o4-mini is rendered
    expect(document.querySelector('[data-testid="phone-model-card-openai:o4-mini"]')).not.toBeNull();
    // Anthropic is collapsed by default, so claude-sonnet is not in DOM
    expect(document.querySelector('[data-testid="phone-model-card-anthropic:claude-sonnet"]')).toBeNull();

    // Tapping Anthropic header expands it
    act(() => {
      anthropicHeader?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="phone-model-card-anthropic:claude-sonnet"]')).not.toBeNull();
  });

  it('selects model and effort directly when tapping inline effort pill', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render({ onSelect, onClose });

    const xhighPill = document.querySelector<HTMLButtonElement>(
      '[data-testid="phone-effort-openai:o4-mini-xhigh"]',
    );
    expect(xhighPill).not.toBeNull();

    act(() => {
      xhighPill?.click();
    });

    expect(onSelect).toHaveBeenCalledWith('openai:o4-mini', 'xhigh');
    expect(onClose).toHaveBeenCalled();
  });

  it('selects model directly when tapping model card', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render({ onSelect, onClose });

    const card = document.querySelector<HTMLDivElement>(
      '[data-testid="phone-model-card-openai:o4-mini"]',
    );
    act(() => {
      card?.click();
    });

    expect(onSelect).toHaveBeenCalledWith('openai:o4-mini', 'xhigh');
    expect(onClose).toHaveBeenCalled();
  });

  it('filters models when typing search query', () => {
    render();
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="thinking-model-search-input"]',
    );
    expect(input).not.toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'gemini');
      input!.dispatchEvent(new window.Event('input', { bubbles: true }));
      input!.dispatchEvent(new window.Event('change', { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="phone-model-card-google:gemini-pro"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="phone-model-card-openai:o4-mini"]')).toBeNull();
  });
});
