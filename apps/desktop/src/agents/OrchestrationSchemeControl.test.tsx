// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import {
  OrchestrationSchemeControl,
  type OrchestrationSchemeControlProps,
} from './OrchestrationSchemeControl';

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

function renderOpen(props: Partial<OrchestrationSchemeControlProps>): void {
  act(() =>
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <OrchestrationSchemeControl
          disabled={false}
          value="auto"
          options={[
            { id: 'off', name: 'Off', description: '', source: 'off' },
            { id: 'auto', name: 'Auto', description: 'Lead routes by need', source: 'builtin' },
          ]}
          onChange={vi.fn()}
          {...props}
        />
      </PiwinUiProvider>,
    ),
  );
  act(() => document.querySelector<HTMLButtonElement>('[data-testid="orchestration-scheme-trigger"]')?.click());
}

describe('OrchestrationSchemeControl delegation switch', () => {
  it('reads as a switch that shows its state and flips it', () => {
    const onDelegationDisabledChange = vi.fn();
    renderOpen({ delegationDisabled: false, onDelegationDisabledChange });
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="orchestration-delegation-disabled"]');
    expect(toggle?.getAttribute('role')).toBe('switch');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(toggle?.querySelector('.orchestration-delegation-switch')).not.toBeNull();
    // Not styled as the selected scheme: the switch carries its state.
    expect(toggle?.classList.contains('is-selected')).toBe(false);
    act(() => toggle?.click());
    expect(onDelegationDisabledChange).toHaveBeenCalledWith(true);
  });

  it('reports on when delegation is disabled', () => {
    renderOpen({ delegationDisabled: true, onDelegationDisabledChange: vi.fn() });
    expect(
      document
        .querySelector('[data-testid="orchestration-delegation-disabled"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
  });
});
