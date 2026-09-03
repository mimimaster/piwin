// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg data-testid="mock-mermaid-svg"></svg>',
    })),
  },
}));

import { MarkdownView } from './MarkdownView.js';
import mermaid from 'mermaid';
import {
  clearMermaidDiagramCacheForTests,
  rememberMermaidDiagramHeight,
} from './mermaid-diagram-cache.js';
import { MermaidBlock } from './MermaidBlock.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MERMAID_FENCE = ['```mermaid', 'graph TD', 'A-->B', '```'].join('\n');
const MERMAID_SOURCE = ['graph TD', 'A-->B'].join('\n');

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderMarkdown(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  const render = { container, root };
  mounted.push(render);
  return render;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  clearMermaidDiagramCacheForTests();
  vi.mocked(mermaid.render).mockClear();
  while (mounted.length > 0) {
    const item = mounted.pop();
    if (!item) continue;
    act(() => {
      item.root.unmount();
    });
    item.container.remove();
  }
});

describe('Mermaid phase upgrade', () => {
  it('keeps mermaid source while streaming and draws after completed on the same mount', async () => {
    const { container, root } = renderMarkdown(
      <MarkdownView text={MERMAID_FENCE} renderingPhase="streaming" />,
    );
    expect(container.querySelector('[data-testid="mermaid-stream-source"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mermaid-diagram"]')).toBeNull();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarkdownView text={MERMAID_FENCE} renderingPhase="completed" />
        </PiwinUiProvider>,
      );
    });
    await flush();

    expect(container.querySelector('[data-testid="mermaid-stream-source"]')).toBeNull();
    expect(container.querySelector('[data-testid="mermaid-diagram"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mock-mermaid-svg"]')).not.toBeNull();
  });

  it('paints a cached svg on remount without calling mermaid.render again', async () => {
    const first = renderMarkdown(
      <MarkdownView text={MERMAID_FENCE} renderingPhase="completed" />,
    );
    await flush();
    expect(vi.mocked(mermaid.render)).toHaveBeenCalledTimes(1);
    expect(first.container.querySelector('[data-testid="mermaid-diagram"]')).not.toBeNull();

    act(() => {
      first.root.unmount();
    });
    first.container.remove();
    mounted.pop();
    vi.mocked(mermaid.render).mockClear();

    const second = renderMarkdown(
      <MarkdownView text={MERMAID_FENCE} renderingPhase="completed" />,
    );
    await flush();
    expect(second.container.querySelector('[data-testid="mermaid-diagram"]')).not.toBeNull();
    expect(vi.mocked(mermaid.render)).not.toHaveBeenCalled();
  });

  it('reserves remembered height while mermaid.render is in flight', async () => {
    rememberMermaidDiagramHeight(MERMAID_SOURCE, 'dark', 480);
    let resolveRender: (value: { svg: string; diagramType: string }) => void = () =>
      undefined;
    const pendingRender = new Promise<{ svg: string; diagramType: string }>((resolve) => {
      resolveRender = resolve;
    });
    vi.mocked(mermaid.render).mockImplementation(() => pendingRender);

    const { container } = renderMarkdown(
      <MermaidBlock source={MERMAID_SOURCE} />,
    );
    const loading = container.querySelector<HTMLElement>('[data-testid="mermaid-loading"]');
    expect(loading).not.toBeNull();
    expect(loading?.getAttribute('data-reserved-height')).toBe('480');
    expect(loading?.style.minHeight).toBe('480px');
    await vi.waitFor(() => {
      expect(vi.mocked(mermaid.render)).toHaveBeenCalled();
    });

    await act(async () => {
      resolveRender({
        svg: '<svg data-testid="mock-mermaid-svg"></svg>',
        diagramType: 'flowchart',
      });
      await Promise.resolve();
    });
    await flush();
    expect(container.querySelector('[data-testid="mermaid-diagram"]')).not.toBeNull();
    vi.mocked(mermaid.render).mockImplementation(async () => ({
      svg: '<svg data-testid="mock-mermaid-svg"></svg>',
      diagramType: 'flowchart',
    }));
  });
});
