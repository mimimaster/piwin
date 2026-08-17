// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeWikiView } from './KnowledgeWikiView.js';

describe('KnowledgeWikiView', () => {
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
  });

  it('does not pretend a folder wiki exists when there are no notes', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeWikiView
            folderPath="/Users/test/piwin"
            folderName="piwin"
            notes={[]}
            request={vi.fn().mockResolvedValue({ success: true, data: {} })}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('这个文件夹还没有检索结果。');
    expect(container.textContent).not.toContain('项目知识库已就绪');
    expect(container.textContent).not.toContain('All source files have been parsed');
  });

  it('maps Host retrieve chunks onto visible passages', async () => {
    const request = vi.fn().mockResolvedValue({
      success: true,
      data: {
        chunks: [
          {
            filePath: 'spaced-repetition.md',
            content: 'The forgetting curve says memory decays quickly after first learning.',
            score: 0.63,
            startLine: 6,
          },
        ],
        degraded: false,
      },
    });
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeWikiView
            folderPath="/docs"
            folderName="docs"
            notes={[]}
            request={request}
          />
        </PiwinUiProvider>,
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="wiki-search-input"] input, [data-testid="wiki-search-input"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, 'spaced repetition');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-search-btn"]')?.click();
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'doccards/retrieve', query: 'spaced repetition' }),
    );
    expect(container.textContent).toContain('forgetting curve');
    expect(container.textContent).toContain('spaced-repetition.md:6');
  });
});
