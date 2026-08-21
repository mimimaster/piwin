// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import {
  resolveSubagentRoleLabel,
  SubagentIdentityChips,
} from './subagent-identity-chip';

describe('resolveSubagentRoleLabel', () => {
  it('prefers the scheme role over the profile id', () => {
    expect(resolveSubagentRoleLabel({ role: 'scout', profileId: 'explorer' })).toBe(
      'scout',
    );
  });

  it('falls back to profile id when role is absent', () => {
    expect(resolveSubagentRoleLabel({ profileId: 'explorer' })).toBe('explorer');
  });
});

describe('SubagentIdentityChips', () => {
  let container: HTMLDivElement;
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
  });

  it('shows the role and a resolved model label with a provider icon', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentIdentityChips
            locale="en"
            role="scout"
            profileId="explorer"
            model={{
              protocol: 'openai-compatible',
              providerId: 'deepseek',
              modelId: 'deepseek-v4-flash',
            }}
            modelOptions={[
              {
                providerId: 'deepseek',
                protocol: 'openai-compatible',
                modelId: 'deepseek-v4-flash',
                label: 'DeepSeek V4 Flash',
              },
            ]}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="subagent-role-chip"]')?.textContent).toBe(
      'scout',
    );
    const modelChip = container.querySelector('[data-testid="subagent-model-chip"]');
    expect(modelChip?.textContent).toContain('DeepSeek V4 Flash');
    expect(modelChip?.querySelector('.subagent-model-chip-icon')).not.toBeNull();
  });

  it('shows a resolving placeholder when the model is not yet known', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentIdentityChips locale="en" role="scout" showModelPlaceholder />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="subagent-model-chip"]')?.textContent).toBe(
      'Resolving model…',
    );
  });
});
