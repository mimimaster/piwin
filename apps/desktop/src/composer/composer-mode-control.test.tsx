// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { ComposerModeControl, type ComposerModeControlProps } from './composer-mode-control';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

function render(overrides: Partial<ComposerModeControlProps> = {}): ComposerModeControlProps {
  const props: ComposerModeControlProps = {
    runDisabled: false,
    runMode: 'yolo',
    onRunModeChange: vi.fn(),
    schemeId: 'auto',
    schemeOptions: [
      { id: 'off', name: 'Off', description: '', source: 'off' },
      { id: 'auto', name: 'Auto', description: 'Lead routes by need', source: 'builtin' },
    ],
    onSchemeChange: vi.fn(),
    delegationDisabled: false,
    ...overrides,
  };
  act(() =>
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ComposerModeControl {...props} />
      </PiwinUiProvider>,
    ),
  );
  return props;
}

function trigger(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="composer-mode-trigger"]');
  if (!button) throw new Error('composer-mode-trigger missing');
  return button;
}

describe('ComposerModeControl', () => {
  it('names both choices on one pill and keeps the YOLO warning', () => {
    render();
    expect(trigger().textContent).toContain('放行');
    expect(trigger().textContent).toContain('Auto');
    expect(document.querySelector('.composer-mode-control')?.classList.contains('is-warning')).toBe(true);
  });

  it('opens one sheet with run mode first and the schemes below', () => {
    render();
    act(() => trigger().click());
    const sheet = document.querySelector('[data-testid="composer-mode-popover"]');
    expect(sheet?.classList.contains('ui-popover-sheet')).toBe(true);
    const runOption = sheet?.querySelector('[data-testid="run-mode-option-auto"]');
    const schemeOption = sheet?.querySelector('[data-testid="orchestration-scheme-option-off"]');
    expect(runOption).not.toBeNull();
    expect(schemeOption).not.toBeNull();
    // Run mode comes first in document order.
    expect(runOption && schemeOption && runOption.compareDocumentPosition(schemeOption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('applies a pick and closes the sheet', () => {
    const props = render();
    act(() => trigger().click());
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="orchestration-scheme-option-off"]')?.click());
    expect(props.onSchemeChange).toHaveBeenCalledWith('off');
    expect(document.querySelector('[data-testid="composer-mode-popover"]')).toBeNull();
  });

  it('shows run mode read-only while a turn runs', () => {
    const props = render({ runDisabled: true });
    act(() => trigger().click());
    const auto = document.querySelector<HTMLButtonElement>('[data-testid="run-mode-option-auto"]');
    expect(auto?.disabled).toBe(true);
    act(() => auto?.click());
    expect(props.onRunModeChange).not.toHaveBeenCalled();
  });
});
