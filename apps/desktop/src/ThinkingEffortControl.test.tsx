// @vitest-environment happy-dom
/**
 * ThinkingEffortControl popover coverage for slice R5.
 * Same happy-dom + createRoot harness as context-bar.test.tsx; the popover
 * is portaled by Radix, so assertions read from document, not the container.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ThinkingEffortControl } from './ThinkingEffortControl.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type ControlProps = Parameters<typeof ThinkingEffortControl>[0];

function createBaseProps(overrides: Partial<ControlProps> = {}): ControlProps {
  return {
    disabled: false,
    modelLabel: 'Acme / gpt-test',
    ultraEnabled: false,
    value: 'medium',
    onChange: vi.fn(),
    models: [
      {
        key: 'acme:gpt-test',
        label: 'Acme / gpt-test',
        thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
        reasoning: true,
      },
      {
        key: 'acme:gpt-mini',
        label: 'Acme / gpt-mini',
        thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
        reasoning: true,
      },
    ],
    selectedModelKey: 'acme:gpt-test',
    onSelectModel: vi.fn(),
    ...overrides,
  };
}

function render(props: ControlProps, root: Root): void {
  const tree: ReactElement = (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <ThinkingEffortControl {...props} />
    </PiwinUiProvider>
  );
  act(() => {
    root.render(tree);
  });
}

function queryTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>(
    '[data-testid="thinking-effort-trigger"]',
  );
  if (!trigger) {
    throw new Error('thinking-effort-trigger not rendered');
  }
  return trigger;
}

function queryPopover(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="thinking-effort-popover"]');
}

/**
 * Native buttons fire `click` for Enter/Space, which is how Radix's popover
 * trigger activates. happy-dom does not synthesize that from a raw keydown,
 * so keyboard activation is exercised through the same activation event.
 */
function activateTrigger(): void {
  act(() => {
    // Focus first: Radix restores focus to whatever was focused when it opened.
    queryTrigger().focus();
    queryTrigger().click();
  });
}

function pressKey(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

function queryModelSearchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="thinking-model-search-input"]',
  );
  if (!input) {
    throw new Error('thinking-model-search-input not rendered');
  }
  return input;
}

function typeIntoSearch(value: string): void {
  act(() => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    nativeInputValueSetter?.call(queryModelSearchInput(), value);
    queryModelSearchInput().dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function queryModelOptions(): Array<HTMLButtonElement> {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="thinking-model-select"] [role="option"]',
    ),
  );
}

describe('ThinkingEffortControl', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders a closed pill with the short model label and effort', () => {
    render(createBaseProps(), root);

    const trigger = queryTrigger();
    expect(trigger.querySelector('.thinking-effort-model')?.textContent).toBe('gpt-test');
    expect(trigger.querySelector('.thinking-effort-value')?.textContent).toBe('Medium');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(queryPopover()).toBeNull();
  });

  it('opens the popover from the keyboard and lists protocol levels', () => {
    render(createBaseProps(), root);

    activateTrigger();

    const popover = queryPopover();
    expect(popover).not.toBeNull();
    expect(queryTrigger().getAttribute('aria-expanded')).toBe('true');

    // OpenAI protocol: off/minimal/low/medium/high/xhigh, no ultra.
    for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']) {
      expect(document.querySelector(`[data-testid="thinking-level-${level}"]`)).not.toBeNull();
    }
    expect(document.querySelector('[data-testid="thinking-level-ultra"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="thinking-level-medium"]')?.getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('never adds the ultra level even when ultra mode is enabled', () => {
    render(
      createBaseProps({
        ultraEnabled: true,
        models: [
          {
            key: 'acme:gpt-test',
            label: 'Acme / gpt-test',
            thinkingLevels: ['off', 'low', 'medium', 'high', 'ultra'],
            reasoning: true,
          },
          {
            key: 'acme:gpt-mini',
            label: 'Acme / gpt-mini',
            thinkingLevels: ['off', 'low', 'medium', 'high', 'ultra'],
            reasoning: true,
          },
        ],
      }),
      root,
    );
    activateTrigger();

    expect(document.querySelector('[data-testid="thinking-level-ultra"]')).toBeNull();
  });

  it('lists exactly the configured effort levels, including max when configured', () => {
    render(
      createBaseProps({
        value: 'high',
        models: [
          {
            key: 'acme:claude',
            label: 'Acme / claude',
            thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
            reasoning: true,
          },
        ],
        selectedModelKey: 'acme:claude',
      }),
      root,
    );
    activateTrigger();

    for (const level of ['off', 'low', 'medium', 'high', 'max']) {
      expect(document.querySelector(`[data-testid="thinking-level-${level}"]`)).not.toBeNull();
    }
    expect(document.querySelector('[data-testid="thinking-level-minimal"]')).toBeNull();
    expect(document.querySelector('[data-testid="thinking-level-xhigh"]')).toBeNull();
  });

  it('moves focus across level chips with the keyboard and selects one', () => {
    const onChange = vi.fn();
    render(createBaseProps({ onChange }), root);
    activateTrigger();

    const low = document.querySelector<HTMLButtonElement>('[data-testid="thinking-level-low"]');
    const high = document.querySelector<HTMLButtonElement>('[data-testid="thinking-level-high"]');
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    if (!low || !high) {
      throw new Error('level chips not rendered');
    }

    // Chips are natively focusable buttons inside the popover.
    act(() => {
      low.focus();
    });
    expect(document.activeElement).toBe(low);
    act(() => {
      high.focus();
    });
    expect(document.activeElement).toBe(high);

    act(() => {
      high.click();
    });
    expect(onChange).toHaveBeenCalledWith('high');
  });

  it('selects a model from the list', () => {
    const onSelectModel = vi.fn();
    render(createBaseProps({ onSelectModel }), root);
    activateTrigger();

    const list = document.querySelector('[data-testid="thinking-model-select"]');
    expect(list).not.toBeNull();
    const options = document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="thinking-model-select"] [role="option"]',
    );
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');

    act(() => {
      options[1]?.click();
    });
    expect(onSelectModel).toHaveBeenCalledWith('acme:gpt-mini');
  });

  it('falls back to an empty-model notice when no models are configured', () => {
    render(createBaseProps({ models: [], selectedModelKey: '' }), root);
    activateTrigger();

    expect(document.querySelector('[data-testid="thinking-model-empty"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="thinking-model-select"]')).toBeNull();
    expect(document.querySelector('[data-testid="thinking-model-search-input"]')).toBeNull();
  });

  it('filters the model list as the user types in the search field', () => {
    render(createBaseProps(), root);
    activateTrigger();

    expect(queryModelOptions()).toHaveLength(2);
    typeIntoSearch('mini');

    const options = queryModelOptions();
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('gpt-mini');

    // Provider prefix also matches.
    typeIntoSearch('acme');
    expect(queryModelOptions()).toHaveLength(2);
  });

  it('shows a no-results notice when the query matches nothing', () => {
    render(createBaseProps(), root);
    activateTrigger();

    typeIntoSearch('nonexistent-model');

    expect(queryModelOptions()).toHaveLength(0);
    expect(document.querySelector('[data-testid="thinking-model-select"]')).toBeNull();
    const notice = document.querySelector('[data-testid="thinking-model-no-results"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('nonexistent-model');
  });

  it('clears the filter with the clear button', () => {
    render(createBaseProps(), root);
    activateTrigger();

    typeIntoSearch('mini');
    expect(queryModelOptions()).toHaveLength(1);

    const clearButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="thinking-model-search-clear"]',
    );
    expect(clearButton).not.toBeNull();
    act(() => {
      clearButton?.click();
    });

    expect(queryModelOptions()).toHaveLength(2);
    expect(queryModelSearchInput().value).toBe('');
  });

  it('selects the first filtered model with Enter', () => {
    const onSelectModel = vi.fn();
    render(createBaseProps({ onSelectModel }), root);
    activateTrigger();

    typeIntoSearch('gpt');
    pressKey(queryModelSearchInput(), 'Enter');

    expect(onSelectModel).toHaveBeenCalledWith('acme:gpt-test');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(createBaseProps(), root);
    activateTrigger();

    const popover = queryPopover();
    expect(popover).not.toBeNull();
    if (!popover) {
      throw new Error('popover not rendered');
    }

    pressKey(popover, 'Escape');

    expect(queryPopover()).toBeNull();
    expect(queryTrigger().getAttribute('aria-expanded')).toBe('false');

    // Radix's focus scope restores focus in a macrotask on unmount.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(document.activeElement).toBe(queryTrigger());
  });

  it('does not open while disabled', () => {
    render(createBaseProps({ disabled: true }), root);

    activateTrigger();

    expect(queryPopover()).toBeNull();
  });
});
