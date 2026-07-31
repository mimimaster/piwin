// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EnhancedMarkdownView } from './EnhancedMarkdownView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('EnhancedMarkdownView', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  function renderView(text: string) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<EnhancedMarkdownView text={text} />);
    });
    return container;
  }

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('renders diff action badges like [MODIFY], [NEW], [DELETE]', () => {
    const md = `
# Implementation Plan

[MODIFY] TS run-activity-types.ts
[NEW] TS run-activity-icon.ts
[DELETE] TS run-activity-old.ts
`;
    const elem = renderView(md);
    expect(elem.querySelector('.badge-modify')).not.toBeNull();
    expect(elem.querySelector('.badge-new')).not.toBeNull();
    expect(elem.querySelector('.badge-delete')).not.toBeNull();
    expect(elem.textContent).toContain('run-activity-types.ts');
  });

  it('renders section headings with scopes', () => {
    const md = `## Desktop App (apps/desktop)`;
    const elem = renderView(md);
    expect(elem.querySelector('.heading-scope')).not.toBeNull();
    expect(elem.querySelector('.heading-scope')?.textContent).toBe('(apps/desktop)');
  });

  it('renders bullet lists and inline code chips', () => {
    const md = `- Extend \`RunActivityInput\` with optional \`actionCategory\``;
    const elem = renderView(md);
    expect(elem.querySelector('.enhanced-list-item')).not.toBeNull();
    expect(elem.querySelector('.enhanced-inline-code')).not.toBeNull();
    expect(elem.querySelector('.enhanced-inline-code')?.textContent).toBe('RunActivityInput');
  });
});
