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

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MERMAID_FENCE = ['```mermaid', 'graph TD', 'A-->B', '```'].join('\n');

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
});
