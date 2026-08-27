// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type ReactElement } from 'react';
import { Popover } from './popover.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('Popover autofocus behavior', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container) {
      container.remove();
    }
    container = null;
    root = null;
  });

  it('renders popover and prevents default autofocus on open by default', () => {
    const onOpenAutoFocus = vi.fn();
    const tree: ReactElement = (
      <Popover
        open={true}
        trigger={<button type="button">Trigger</button>}
        testId="test-popover"
        onOpenAutoFocus={onOpenAutoFocus}
      >
        <button type="button" data-testid="inside-btn">
          Inside
        </button>
      </Popover>
    );

    act(() => {
      root!.render(tree);
    });

    const popover = document.querySelector('[data-testid="test-popover"]');
    expect(popover).not.toBeNull();
    expect(onOpenAutoFocus).toHaveBeenCalled();
  });
});
