// @vitest-environment happy-dom
/**
 * AddModelDialog catalog combobox: debounce search + apply fills limits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ModelCatalogEntry, ModelConfigEntry } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { AddModelDialog } from './AddModelDialog';
import { DesktopLocaleProvider } from './desktop-locale-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function catalogEntry(
  partial: Partial<ModelCatalogEntry> & Pick<ModelCatalogEntry, 'modelId'>,
): ModelCatalogEntry {
  return {
    catalogProviderId: partial.catalogProviderId ?? 'deepseek',
    modelId: partial.modelId,
    name: partial.name ?? partial.modelId,
    input: partial.input ?? ['text'],
    reasoning: partial.reasoning ?? true,
    contextWindow: partial.contextWindow ?? 128_000,
    maxTokens: partial.maxTokens ?? 16_384,
    cost: partial.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function resolveInput(root: ParentNode, testId: string): HTMLInputElement | null {
  const host = root.querySelector(`[data-testid="${testId}"]`);
  if (!host) return null;
  if (host instanceof HTMLInputElement) return host;
  return host.querySelector('input');
}

describe('AddModelDialog catalog autocomplete', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
    vi.useRealTimers();
  });

  function renderDialog(ui: ReactElement): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
              {ui}
            </DesktopLocaleProvider>
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
  }

  it('searches catalog after debounce and fills limits on select', async () => {
    vi.useFakeTimers();
    const searchCatalog = vi.fn(async (query: string) => {
      expect(query).toBe('dee');
      return [
        catalogEntry({
          modelId: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          contextWindow: 1_000_000,
          maxTokens: 384_000,
          reasoning: true,
          input: ['text'],
        }),
      ];
    });
    const onAdd = vi.fn();
    const onOpenChange = vi.fn();

    renderDialog(
      <AddModelDialog
        open
        onOpenChange={onOpenChange}
        existingModelIds={[]}
        onAdd={onAdd}
        searchCatalog={searchCatalog}
      />,
    );

    // Mantine Modal portals into document.body.
    const scope = document.body;
    const input = resolveInput(scope, 'add-model-id-input');
    expect(input).not.toBeNull();

    await act(async () => {
      setInputValue(input, 'dee');
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(searchCatalog).toHaveBeenCalledWith('dee');
    const list = scope.querySelector('[data-testid="add-model-catalog-suggestions"]');
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain('deepseek-v4-pro');
    expect(list?.textContent).toMatch(/1M ctx/i);
    expect(list?.textContent).toMatch(/384K out/i);

    const option = scope.querySelector('.add-model-catalog-option') as HTMLButtonElement | null;
    expect(option).not.toBeNull();

    await act(async () => {
      option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });

    const contextInput = resolveInput(scope, 'add-model-context-input');
    const outputInput = resolveInput(scope, 'add-model-output-input');
    expect(contextInput?.value).toBe('1000000');
    expect(outputInput?.value).toBe('384000');

    await act(async () => {
      const submit = scope.querySelector(
        '[data-testid="add-model-submit"]',
      ) as HTMLButtonElement | null;
      submit?.click();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    const added = onAdd.mock.calls[0]?.[0] as ModelConfigEntry;
    expect(added.id).toBe('deepseek-v4-pro');
    expect(added.contextWindow).toBe(1_000_000);
    expect(added.maxOutputTokens).toBe(384_000);
    expect(added.reasoning).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not search when catalog callback is missing', async () => {
    vi.useFakeTimers();
    renderDialog(
      <AddModelDialog
        open
        onOpenChange={() => undefined}
        existingModelIds={[]}
        onAdd={() => undefined}
      />,
    );
    const scope = document.body;
    const input = resolveInput(scope, 'add-model-id-input');
    await act(async () => {
      setInputValue(input, 'dee');
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(scope.querySelector('[data-testid="add-model-catalog-suggestions"]')).toBeNull();
    expect(scope.querySelector('[data-testid="add-model-catalog-searching"]')).toBeNull();
  });

  it('persists native web-search capability while adding', async () => {
    const onAdd = vi.fn();
    renderDialog(
      <AddModelDialog open onOpenChange={() => undefined} existingModelIds={[]} onAdd={onAdd} />,
    );
    const scope = document.body;
    const modelId = resolveInput(scope, 'add-model-id-input');
    const nativeSearch = scope.querySelector(
      '[data-testid="add-model-native-web-search"]',
    ) as HTMLInputElement | null;

    await act(async () => {
      setInputValue(modelId, 'search-model');
      nativeSearch?.click();
    });

    await act(async () => {
      const submit = scope.querySelector(
        '[data-testid="add-model-submit"]',
      ) as HTMLButtonElement | null;
      submit?.click();
    });

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'search-model',
        capabilities: ['native-web-search'],
      }),
    );
  });

  it('persists video-generation capability while adding', async () => {
    const onAdd = vi.fn();
    renderDialog(
      <AddModelDialog open onOpenChange={() => undefined} existingModelIds={[]} onAdd={onAdd} />,
    );
    const scope = document.body;

    await act(async () => {
      setInputValue(resolveInput(scope, 'add-model-id-input'), 'grok-imagine-video');
      const videoGeneration = scope.querySelector(
        '[data-testid="add-model-video-generation"]',
      ) as HTMLInputElement | null;
      videoGeneration?.click();
    });

    await act(async () => {
      const submit = scope.querySelector(
        '[data-testid="add-model-submit"]',
      ) as HTMLButtonElement | null;
      submit?.click();
    });

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'grok-imagine-video',
        capabilities: ['video-generation'],
      }),
    );
  });
});
