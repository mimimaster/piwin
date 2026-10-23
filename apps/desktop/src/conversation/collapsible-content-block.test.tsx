// @vitest-environment happy-dom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
import {
  CollapsibleContentBlock,
  resolveCollapsibleOverflow,
} from './collapsible-content-block.js';

describe('resolveCollapsibleOverflow', () => {
  it('trusts an explicit expandable flag and ignores preview measurements', () => {
    expect(resolveCollapsibleOverflow(false, true)).toBe(false);
    expect(resolveCollapsibleOverflow(true, false)).toBe(true);
  });

  it('falls back to measurement only when the caller did not decide', () => {
    expect(resolveCollapsibleOverflow(undefined, true)).toBe(true);
    expect(resolveCollapsibleOverflow(undefined, false)).toBe(false);
  });
});

describe('CollapsibleContentBlock expandable override', () => {
  let host: HTMLDivElement;
  let root: Root;
  let scrollHeightSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    scrollHeightSpy?.mockRestore();
  });

  it('does not start collapsing a short fence when wrap measurement exceeds the clip', () => {
    scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(214);
    act(() => {
      root.render(
        <CollapsibleContentBlock
          maxCollapsedHeight={200}
          defaultCollapsed
          expandable={false}
          className="md-code-collapsible"
        >
          <pre>docker run</pre>
        </CollapsibleContentBlock>,
      );
    });
    const block = host.querySelector('[data-testid="collapsible-content-block"]');
    expect(block?.classList.contains('is-expanded')).toBe(true);
    expect(block?.classList.contains('has-overflow')).toBe(false);
    expect(host.querySelector('[data-testid="collapsible-content-toggle"]')).toBeNull();
  });

  it('clips the outer box and does not unclamp the inner node to measure', () => {
    scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
    act(() => {
      root.render(
        <CollapsibleContentBlock maxCollapsedHeight={130} defaultCollapsed>
          <pre>{'line\n'.repeat(40)}</pre>
        </CollapsibleContentBlock>,
      );
    });
    const block = host.querySelector<HTMLElement>('[data-testid="collapsible-content-block"]');
    const inner = host.querySelector<HTMLElement>('.collapsible-content-inner');
    expect(block?.classList.contains('is-collapsed')).toBe(true);
    expect(block?.style.maxHeight).toBe('130px');
    expect(inner?.style.maxHeight).toBe('');
  });

  it('stays collapsible when the caller marked the fence tall', () => {
    act(() => {
      root.render(
        <CollapsibleContentBlock
          maxCollapsedHeight={200}
          defaultCollapsed
          expandable
          renderCollapsed={() => <pre>preview</pre>}
          renderExpanded={() => <pre>full</pre>}
        >
          <pre>full</pre>
        </CollapsibleContentBlock>,
      );
    });
    const block = host.querySelector('[data-testid="collapsible-content-block"]');
    expect(block?.classList.contains('is-collapsed')).toBe(true);
    expect(block?.classList.contains('has-overflow')).toBe(true);
  });
});
