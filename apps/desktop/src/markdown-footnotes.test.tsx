// @vitest-environment happy-dom
/** Regression coverage for GFM footnote definition rendering. */
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

describe('MarkdownView GFM footnotes', () => {
  it('renders footnote definition text and a backref, not an empty disc list', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={['脚注示例[^1]，结束。', '', '[^1]: 这是脚注正文'].join('\n')}
        renderingPhase="completed"
      />,
    );

    const markdown = container.querySelector('.markdown');
    expect(markdown?.textContent).toContain('脚注示例');
    expect(markdown?.textContent).toContain('这是脚注正文');

    const section = container.querySelector('section.md-footnotes, section[data-footnotes]');
    expect(section).not.toBeNull();
    expect(container.querySelector('section.md-footnotes')).not.toBeNull();
    expect(section?.textContent).toContain('这是脚注正文');

    const backref = container.querySelector(
      'a[data-footnote-backref], a.data-footnote-backref',
    );
    expect(backref).not.toBeNull();
  });
});
