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
    expect(elem.querySelector('ul.enhanced-list > li.enhanced-list-item')).not.toBeNull();
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

  it('keeps ordinary Markdown on the Streamdown review surface', () => {
    const elem = renderView('A **reviewable** paragraph with _important_ ~~old~~ text.');
    expect(elem.querySelector('.enhanced-markdown-streamdown')).not.toBeNull();
    expect(elem.querySelector('.enhanced-strong')?.textContent).toBe('reviewable');
    expect(elem.querySelector('.enhanced-em')?.textContent).toBe('important');
    expect(elem.querySelector('del')?.textContent).toBe('old');
  });

  it('renders diff lines in code blocks', () => {
    const md = `\`\`\`diff\n+ added line\n- deleted line\n  context line\n\`\`\``;
    const elem = renderView(md);
    expect(elem.querySelector('.diff-line-add')).not.toBeNull();
    expect(elem.querySelector('.diff-line-delete')).not.toBeNull();
  });

  it('renders line-number gutters in fenced code blocks', () => {
    const md = `\`\`\`ts\nconst a = 1;\nconst b = 2;\n\`\`\``;
    const elem = renderView(md);
    const nums = elem.querySelectorAll('.code-line-num');
    expect(nums.length).toBe(2);
    expect(nums[0]?.textContent).toBe('1');
    expect(nums[1]?.textContent).toBe('2');
  });

  it('parses ordered lists as ordered-list blocks', () => {
    const elem = renderView('1. First\n2. Second\n');
    expect(elem.textContent).toContain('First');
    expect(elem.querySelector('ol.enhanced-ordered-list')).not.toBeNull();
  });

  it('keeps nested list comment buttons off the parent line wrapper', () => {
    const md = `4. Add bounded, Host-owned client commands for Desktop reads:
   - \`project/tree\` ;
   - \`project/read\` ;
   - \`artifact/read\` .
`;
    const elem = renderView(md);
    const parentItem = elem.querySelector('ol.enhanced-list > li.enhanced-list-item');
    expect(parentItem).not.toBeNull();
    const parentWrapper = parentItem?.querySelector(':scope > .enhanced-line-wrapper');
    expect(parentWrapper).not.toBeNull();
    expect(parentWrapper?.querySelectorAll(':scope > .line-comment-btn')).toHaveLength(1);
    expect(parentWrapper?.querySelectorAll('.line-comment-btn')).toHaveLength(1);
    expect(parentItem?.querySelectorAll(':scope > ul.enhanced-list')).toHaveLength(1);
    expect(parentItem?.querySelectorAll('.line-comment-btn')).toHaveLength(4);
  });

  it('parses plain blockquotes', () => {
    const elem = renderView('> quoted evidence\n');
    expect(elem.querySelector('.enhanced-blockquote')).not.toBeNull();
    expect(elem.querySelector('blockquote')?.textContent).toContain('quoted evidence');
  });
});
