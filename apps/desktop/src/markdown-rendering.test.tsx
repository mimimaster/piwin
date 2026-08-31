// @vitest-environment happy-dom
/** Regression coverage for the semantic Markdown and transcript typography contract. */
import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { MarkdownView } from './MarkdownView.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRenders: Array<{ container: HTMLElement; root: Root }> = [];

function renderMarkdown(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  const mounted = { container, root };
  mountedRenders.push(mounted);
  return mounted;
}

function cleanupRenders(): void {
  while (mountedRenders.length > 0) {
    const mounted = mountedRenders.pop();
    if (!mounted) continue;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
}

afterEach(cleanupRenders);

describe('MarkdownView semantic rendering', () => {
  it('renders emphasis as semantic elements with app-owned classes', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={'**根因：** _需要复现_ ~~旧结论~~ `requestCalls = []`'}
        renderingPhase="completed"
      />,
    );

    expect(container.querySelector('strong.md-strong')?.textContent).toBe('根因：');
    expect(container.querySelector('.font-semibold')).toBeNull();
    expect(container.querySelector('em.md-em')?.textContent).toBe('需要复现');
    expect(container.querySelector('del.md-del')?.textContent).toBe('旧结论');
    expect(container.querySelector('code.md-inline-code')?.textContent).toBe('requestCalls = []');
  });

  it('applies the document hierarchy classes to headings and lists', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={'## 改动\n\n- 第一项\n- **第二项**'} renderingPhase="completed" />,
    );

    expect(container.querySelector('h2.md-h2')?.textContent).toBe('改动');
    expect(container.querySelectorAll('ul.md-list > li.md-list-item')).toHaveLength(2);
    expect(container.querySelector('li strong.md-strong')?.textContent).toBe('第二项');
  });
});
