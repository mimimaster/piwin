/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { ModelCatalogEntry } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ModelEditPopover } from './model-edit-popover.js';

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
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>,
    );
  });
  instances.push({ container, root });
  return { container, root };
}

describe('ModelEditPopover', () => {
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
      <ModelEditPopover
        model={{ id: 'gpt-test' }}
        providerProtocol="openai-compatible"
        disabled={false}
        isChinese={false}
        searchCatalog={searchCatalog}
        onSave={vi.fn()}
      />,
    );
    click('[data-testid="provider-model-edit-gpt-test"]');
    await waitFor(() => input('model-edit-context').value === '200000');
    expect(input('model-edit-output').value).toBe('32000');
    expect(input('model-edit-supports-image').checked).toBe(true);
  });

  it('shows and saves max only when the user configures max', () => {
    const onSave = vi.fn();
    render(
      <ModelEditPopover
        model={{
          id: 'claude-max',
          reasoning: true,
          thinkingLevels: ['off', 'low', 'medium', 'high'],
        }}
        providerProtocol="anthropic-compatible"
        disabled={false}
        isChinese={false}
        onSave={onSave}
      />,
    );
    click('[data-testid="provider-model-edit-claude-max"]');
    expect(query<HTMLInputElement>('[data-testid="model-edit-thinking-level-max"]')?.checked).not.toBe(true);
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
});
