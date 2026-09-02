// @vitest-environment happy-dom
/**
 * AgentModeControl popover coverage. Same happy-dom + createRoot harness as
 * ThinkingEffortControl; the popover is portaled by Radix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { AgentModeControl, type AgentModeControlProps } from './AgentModeControl.js';
import { DesktopLocaleProvider } from './desktop-locale-context.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createBaseProps(overrides: Partial<AgentModeControlProps> = {}): AgentModeControlProps {
  return {
    disabled: false,
    value: 'agent',
    onChange: vi.fn(),
    ...overrides,
  };
}

function render(props: AgentModeControlProps, root: Root): void {
  const tree: ReactElement = (
    <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <AgentModeControl {...props} />
      </PiwinUiProvider>
    </DesktopLocaleProvider>
  );
  act(() => {
    root.render(tree);
  });
}

function queryTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>('[data-testid="agent-mode-trigger"]');
  if (!trigger) {
    throw new Error('agent-mode-trigger not rendered');
  }
  return trigger;
}

function queryPopover(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="agent-mode-popover"]');
}

function activateTrigger(): void {
  act(() => {
    queryTrigger().focus();
    queryTrigger().click();
  });
}

describe('AgentModeControl', () => {
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

  it('renders a closed pill with the current mode', () => {
    render(createBaseProps(), root);

    const trigger = queryTrigger();
    expect(trigger.textContent).toContain('Agent');
    expect(trigger.getAttribute('data-mode')).toBe('agent');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(queryPopover()).toBeNull();
  });

  it('opens the popover and switches to Goal', () => {
    const onChange = vi.fn();
    render(createBaseProps({ onChange }), root);

    activateTrigger();

    expect(queryPopover()).not.toBeNull();
    const goalOption = document.querySelector<HTMLButtonElement>(
      '[data-testid="agent-mode-option-goal"]',
    );
    expect(goalOption).not.toBeNull();
    expect(goalOption?.disabled).toBe(false);

    act(() => {
      goalOption?.click();
    });

    expect(onChange).toHaveBeenCalledWith('goal');
    expect(queryPopover()).toBeNull();
  });

  it('disables Goal and points at Extensions when the extension is off', () => {
    const onChange = vi.fn();
    const onOpenExtensionsSettings = vi.fn();
    render(
      createBaseProps({
        onChange,
        goalDisabled: true,
        onOpenExtensionsSettings,
      }),
      root,
    );

    activateTrigger();

    const goalOption = document.querySelector<HTMLButtonElement>(
      '[data-testid="agent-mode-option-goal"]',
    );
    expect(goalOption?.disabled).toBe(true);
    expect(goalOption?.textContent).toMatch(/Settings → Extensions/);

    act(() => {
      goalOption?.click();
    });
    expect(onChange).not.toHaveBeenCalled();

    const footer = document.querySelector<HTMLButtonElement>(
      '[data-testid="agent-mode-open-extensions"]',
    );
    expect(footer).not.toBeNull();
    act(() => {
      footer?.click();
    });
    expect(onOpenExtensionsSettings).toHaveBeenCalledTimes(1);
    expect(queryPopover()).toBeNull();
  });

  it('highlights Goal when that mode is already selected', () => {
    render(createBaseProps({ value: 'goal' }), root);

    expect(queryTrigger().getAttribute('data-mode')).toBe('goal');
    expect(queryTrigger().textContent).toContain('Goal');
    expect(document.querySelector('.agent-mode-control')?.classList.contains('is-active')).toBe(
      true,
    );
  });
});
