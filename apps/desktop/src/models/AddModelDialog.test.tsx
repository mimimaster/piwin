// @vitest-environment happy-dom
/**
 * AddModelDialog catalog combobox: debounce search + apply fills limits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ModelCatalogEntry, ModelConfigEntry } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { AddModelDialog } from './AddModelDialog';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context';

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
        routes: {
          'video-generation': { apiStyle: 'xgrok-videos', path: '/videos/generations' },
        },
      }),
    );
  });

  it('defaults 模型内置搜索 for search-capable models until the user touches it', () => {
    renderDialog(
      <AddModelDialog
        open
        onOpenChange={vi.fn()}
        existingModelIds={[]}
        onAdd={vi.fn()}
        protocol="openai-compatible"
        baseUrl="http://127.0.0.1:8317/v1"
      />,
    );
    const scope = document.body;
    const input = resolveInput(scope, 'add-model-id-input');
    const searchBox = (): HTMLInputElement | null =>
      scope.querySelector<HTMLInputElement>('[data-testid="add-model-native-web-search"]');

    act(() => setInputValue(input, 'grok-4.7'));
    expect(searchBox()?.checked).toBe(true);
    // Gemini on an OpenAI row cannot run Gemini search: not defaulted.
    act(() => setInputValue(input, 'gemini-3.8-flash-high'));
    expect(searchBox()?.checked).toBe(false);
    act(() => setInputValue(input, 'glm-4.1v'));
    expect(searchBox()?.checked).toBe(false);

    // A manual choice wins over later id edits.
    act(() => setInputValue(input, 'grok-4.7'));
    act(() => searchBox()?.click());
    expect(searchBox()?.checked).toBe(false);
    act(() => setInputValue(input, 'grok-4.6'));
    expect(searchBox()?.checked).toBe(false);
  });

  it('keeps a Vertex row on its own wire and defaults Gemini to Google Search grounding', () => {
    const onAdd = vi.fn<(model: ModelConfigEntry) => void>();
    renderDialog(
      <AddModelDialog open onOpenChange={vi.fn()} existingModelIds={[]} onAdd={onAdd} protocol="google-vertex" />,
    );
    const scope = document.body;
    act(() => setInputValue(resolveInput(scope, 'add-model-id-input'), 'gemini-2.5-pro'));

    expect(scope.querySelector('[data-testid="add-model-protocol"]')).toBeNull();
    const searchBox = scope.querySelector<HTMLInputElement>('[data-testid="add-model-native-web-search"]');
    expect(searchBox?.disabled).toBe(false);
    expect(searchBox?.checked).toBe(true);
    const adapter = scope.querySelector<HTMLSelectElement>('[data-testid="model-edit-native-search-adapter"]');
    // Only Vertex's own grounding is offered: no "switch to Gemini protocol" entry.
    expect([...(adapter?.options ?? [])].map((option) => option.value)).toEqual(['', 'google-search-tool']);

    act(() => scope.querySelector<HTMLButtonElement>('[data-testid="add-model-submit"]')?.click());
    expect(onAdd.mock.calls[0]?.[0].capabilities).toContain('native-web-search');
    expect(onAdd.mock.calls[0]?.[0].protocol).toBeUndefined();
  });

  it('locks built-in search off on Bedrock, which has no hosted search', () => {
    renderDialog(
      <AddModelDialog
        open
        onOpenChange={vi.fn()}
        existingModelIds={[]}
        onAdd={vi.fn()}
        protocol="amazon-bedrock"
        nativeSearchBlocker="amazon-bedrock provider bedrock has no hosted web search"
      />,
    );
    const scope = document.body;
    act(() => setInputValue(resolveInput(scope, 'add-model-id-input'), 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'));

    expect(scope.querySelector('[data-testid="add-model-protocol"]')).toBeNull();
    const searchBox = scope.querySelector<HTMLInputElement>('[data-testid="add-model-native-web-search"]');
    expect(searchBox?.disabled).toBe(true);
    expect(searchBox?.checked).toBe(false);
    expect(scope.querySelector('[data-testid="add-model-native-search-blocked"]')?.textContent).toContain('Bedrock');
  });

  it('adds an OpenRouter model pinned to an upstream with custom headers (ADR 0095)', () => {
    const onAdd = vi.fn();
    renderDialog(
      <AddModelDialog
        open
        onOpenChange={vi.fn()}
        existingModelIds={[]}
        onAdd={onAdd}
        baseUrl="https://openrouter.ai/api/v1"
      />,
    );
    const scope = document.body;
    act(() => setInputValue(resolveInput(scope, 'add-model-id-input'), 'anthropic/claude-sonnet-4.5'));
    expect(
      scope.querySelector('[data-testid="add-model-request-toggle"]')?.getAttribute('aria-expanded'),
    ).toBe('false');
    act(() => scope.querySelector<HTMLButtonElement>('[data-testid="add-model-request-toggle"]')?.click());
    act(() => setInputValue(resolveInput(scope, 'add-model-openrouter-order'), 'anthropic, google-vertex'));
    act(() => scope.querySelector<HTMLInputElement>('[data-testid="add-model-openrouter-no-fallback"]')?.click());
    act(() => scope.querySelector<HTMLButtonElement>('[data-testid="add-model-header-add"]')?.click());
    act(() => setInputValue(resolveInput(scope, 'add-model-header-name'), 'X-Title'));
    act(() => setInputValue(resolveInput(scope, 'add-model-header-value'), 'piwin'));
    act(() => scope.querySelector<HTMLButtonElement>('[data-testid="add-model-submit"]')?.click());

    const added = onAdd.mock.calls[0]?.[0] as ModelConfigEntry;
    expect(added.extraBody).toEqual({
      provider: { order: ['anthropic', 'google-vertex'], allow_fallbacks: false },
    });
    expect(added.headers).toEqual({ 'X-Title': 'piwin' });
  });

  it('refuses to add a model whose custom body is not valid JSON', () => {
    const onAdd = vi.fn();
    renderDialog(
      <AddModelDialog open onOpenChange={vi.fn()} existingModelIds={[]} onAdd={onAdd} />,
    );
    const scope = document.body;
    act(() => setInputValue(resolveInput(scope, 'add-model-id-input'), 'gpt-test'));
    expect(scope.querySelector('[data-testid="add-model-openrouter"]')).toBeNull();
    const body = scope.querySelector<HTMLTextAreaElement>('[data-testid="add-model-request-body"] textarea');
    act(() => {
      if (!body) return;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(
        body,
        '{"temperature": 0.7,',
      );
      body.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(scope.querySelector('[data-testid="add-model-request-body"]')?.textContent).toContain(
      'JSON 格式错误',
    );
    act(() => scope.querySelector<HTMLButtonElement>('[data-testid="add-model-submit"]')?.click());
    expect(onAdd).not.toHaveBeenCalled();
    expect(scope.querySelector('[data-testid="add-model-request-error"]')).not.toBeNull();
  });
});
