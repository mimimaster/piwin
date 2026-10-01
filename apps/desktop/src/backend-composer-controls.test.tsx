// @vitest-environment happy-dom
/**
 * Backend session control coverage (ADR 0082).
 * The popover is portaled by Radix, so assertions read from document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SessionBackendOptions } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { BackendComposerControls } from './backend-composer-controls.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type ControlProps = Parameters<typeof BackendComposerControls>[0];

function options(overrides: Partial<SessionBackendOptions> = {}): SessionBackendOptions {
  return {
    agentId: 'grok',
    models: [
      { id: 'grok-4', label: 'Grok 4', efforts: ['low', 'high'] },
      { id: 'grok-4-fast', label: 'Grok 4 Fast' },
    ],
    currentModelId: 'grok-4',
    currentEffortId: 'low',
    modes: [
      { id: 'default', label: 'Default' },
      { id: 'plan', label: 'Plan' },
    ],
    currentModeId: 'default',
    modeConfirmed: true,
    commands: [],
    ...overrides,
  };
}

function createBaseProps(overrides: Partial<ControlProps> = {}): ControlProps {
  return {
    options: options(),
    agentLabel: 'Grok',
    disabled: false,
    onSelectModel: vi.fn(),
    onSelectEffort: vi.fn(),
    onSelectMode: vi.fn(),
    ...overrides,
  };
}

function render(props: ControlProps, root: Root): void {
  const tree: ReactElement = (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <BackendComposerControls {...props} />
    </PiwinUiProvider>
  );
  act(() => {
    root.render(tree);
  });
}

function queryTrigger(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-testid="backend-controls-trigger"]');
}

function openPopover(): void {
  const trigger = queryTrigger();
  if (!trigger) {
    throw new Error('backend-controls-trigger not rendered');
  }
  act(() => {
    trigger.focus();
    trigger.click();
  });
}

function queryById(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function clickById(testId: string): void {
  const element = queryById(testId);
  if (!element) {
    throw new Error(`${testId} not rendered`);
  }
  act(() => {
    element.click();
  });
}

describe('BackendComposerControls', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('shows the current model and mode on the trigger', () => {
    render(createBaseProps(), root);
    const trigger = queryTrigger();
    expect(trigger?.textContent).toContain('Grok');
    expect(trigger?.textContent).toContain('Grok 4');
    expect(trigger?.textContent).toContain('Default');
  });

  it('marks a pending mode instead of claiming it is active', () => {
    render(createBaseProps({ options: options({ modeConfirmed: false }) }), root);
    expect(queryById('backend-mode-label')?.textContent).toContain('…');

    openPopover();
    expect(queryById('backend-mode-pending')).not.toBeNull();
  });

  it('shows the auto-approve badge only when the agent reports it', () => {
    render(createBaseProps(), root);
    expect(queryById('backend-auto-approve-badge')).toBeNull();

    render(createBaseProps({ options: options({ autoApprove: true }) }), root);
    expect(queryById('backend-auto-approve-badge')).not.toBeNull();
  });

  it('offers only the selected model effort list', () => {
    render(createBaseProps(), root);
    openPopover();

    expect(queryById('backend-effort-low')).not.toBeNull();
    expect(queryById('backend-effort-high')).not.toBeNull();
    // Another model's effort ids must not leak into this model's choices.
    expect(queryById('backend-effort-medium')).toBeNull();
  });

  it('hides the effort section for a model that declares none', () => {
    // `exactOptionalPropertyTypes` forbids passing an explicit `undefined`,
    // so drop the key the way a backend with no effort control would.
    const noEffort = options({ currentModelId: 'grok-4-fast' });
    delete noEffort.currentEffortId;

    render(createBaseProps({ options: noEffort }), root);
    openPopover();

    expect(queryById('backend-effort-low')).toBeNull();
    expect(queryById('backend-model-grok-4-fast')).not.toBeNull();
  });

  it('reports model, effort and mode selections to the caller', () => {
    const props = createBaseProps();
    render(props, root);
    openPopover();

    clickById('backend-model-grok-4-fast');
    clickById('backend-mode-plan');
    clickById('backend-effort-high');

    expect(props.onSelectModel).toHaveBeenCalledWith('grok-4-fast');
    expect(props.onSelectMode).toHaveBeenCalledWith('plan');
    expect(props.onSelectEffort).toHaveBeenCalledWith('high');
  });

  it('filters the model list by the search query', () => {
    render(createBaseProps(), root);
    openPopover();

    const input = queryById('backend-model-search-input') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'fast');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    expect(queryById('backend-model-grok-4-fast')).not.toBeNull();
    expect(queryById('backend-model-grok-4')).toBeNull();
  });

  it('disables the trigger while a run is streaming', () => {
    render(createBaseProps({ disabled: true }), root);
    expect(queryTrigger()?.disabled).toBe(true);
  });

  it('hides mode, plan mode and auto-approve badge when hideModes is true', () => {
    render(createBaseProps({ hideModes: true, options: options({ autoApprove: true }) }), root);
    const trigger = queryTrigger();
    expect(trigger?.textContent).toContain('Grok');
    expect(trigger?.textContent).toContain('Grok 4');
    expect(trigger?.textContent).not.toContain('Default');
    expect(trigger?.textContent).not.toContain('Plan');
    expect(queryById('backend-auto-approve-badge')).toBeNull();

    openPopover();
    expect(queryById('backend-mode-plan')).toBeNull();
    expect(queryById('backend-mode-default')).toBeNull();
    expect(queryById('backend-effort-low')).not.toBeNull();
    expect(queryById('backend-model-grok-4')).not.toBeNull();
  });
});
