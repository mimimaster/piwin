// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
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
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <EnhancedMarkdownView text={text} />
        </PiwinUiProvider>,
      );
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

  it('renders details and summary accordion blocks', () => {
    const md = `<details>\n<summary>Click to see details</summary>\nDetailed evidence content\n</details>`;
    const elem = renderView(md);
    expect(elem.querySelector('.enhanced-details')).not.toBeNull();
    expect(elem.querySelector('.enhanced-summary')?.textContent).toBe('Click to see details');
  });

  it('renders task checkboxes for - [x] and - [ ]', () => {
    const md = `- [x] Task 1 completed\n- [ ] Task 2 pending`;
    const elem = renderView(md);
    const checkboxes = elem.querySelectorAll<HTMLInputElement>('.enhanced-checkbox');
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0]?.checked).toBe(true);
    expect(checkboxes[1]?.checked).toBe(false);
  });

  it('renders diff lines in code blocks', () => {
    const md = `\`\`\`diff\n+ added line\n- deleted line\n  context line\n\`\`\``;
    const elem = renderView(md);
    expect(elem.querySelector('.diff-line-add')).not.toBeNull();
    expect(elem.querySelector('.diff-line-delete')).not.toBeNull();
  });
});
