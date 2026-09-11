// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { KnowledgeCitation } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { MarkdownView } from '../MarkdownView.js';
import { KnowledgeCitationActionsProvider } from './knowledge-citation-actions.js';
import { KnowledgeCitationSources } from './KnowledgeCitationSources.js';
import type { KnowledgeCitationIndex } from './knowledge-citations.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const citation: KnowledgeCitation = {
  ref: 1,
  baseId: 'folder:0123456789abcdef',
  baseName: 'fsrs-papers',
  kind: 'folder',
  title: 'fsrs/overview.md',
  relativePath: 'fsrs/overview.md',
  startLine: 12,
  endLine: 18,
  text: 'Stability decides the next review interval.',
};

const index: KnowledgeCitationIndex = new Map([[1, citation]]);

describe('knowledge citations in rendered markdown', () => {
  let container: HTMLElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(node: React.ReactNode): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
    });
  }

  it('renders resolved markers as citations and keeps unresolved ones as text', () => {
    const openCitation = vi.fn();
    render(
      <KnowledgeCitationActionsProvider value={{ openCitation }}>
        <MarkdownView text="FSRS uses stability [1]. Unknown [3]." knowledgeCitations={index} />
      </KnowledgeCitationActionsProvider>,
    );
    const marker = container.querySelector<HTMLButtonElement>('[data-testid="kb-cite-1"] button');
    expect(marker?.textContent).toBe('1');
    expect(container.textContent).not.toContain('[blocked]');
    expect(container.textContent).toContain('Unknown [3].');
    expect(container.querySelector('a[href*="kb-cite"]')).toBeNull();
    act(() => marker?.click());
    expect(openCitation).toHaveBeenCalledWith(citation);
  });

  it('leaves markers as plain text when no citations were retrieved', () => {
    render(<MarkdownView text="Plain reference [1]." />);
    expect(container.querySelector('[data-testid="kb-cite-1"]')).toBeNull();
    expect(container.textContent).toContain('Plain reference [1].');
  });

  it('lists cited sources and opens them', () => {
    const openCitation = vi.fn();
    render(
      <KnowledgeCitationActionsProvider value={{ openCitation }}>
        <KnowledgeCitationSources citations={[citation]} locale="zh-CN" />
      </KnowledgeCitationActionsProvider>,
    );
    expect(container.textContent).toContain('来源');
    expect(container.textContent).toContain('L12–18');
    const row = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-citation-source-1"]',
    );
    act(() => row?.click());
    expect(openCitation).toHaveBeenCalledWith(citation);
  });
});
