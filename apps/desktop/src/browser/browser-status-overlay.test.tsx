// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserStatusOverlay, type BrowserStatusOverlayProps } from './browser-status-overlay';

describe('BrowserStatusOverlay', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(props: Partial<BrowserStatusOverlayProps>): void {
    act(() => {
      root.render(
        <BrowserStatusOverlay
          pending={null}
          errors={[]}
          clearHighlightLabel={null}
          onClearHighlight={() => undefined}
          {...props}
        />,
      );
    });
  }

  it('renders nothing when there is no status', () => {
    render({});
    expect(host.innerHTML).toBe('');
  });

  it('shows pending and each error as its own pill', () => {
    render({
      pending: 'Resolving element…',
      errors: [
        { testId: 'browser-session-pick-error', message: 'pick failed' },
        { testId: 'browser-session-frame-error', message: 'frame failed' },
      ],
    });
    const pending = host.querySelector('[data-testid="browser-session-pick-pending"]');
    expect(pending?.getAttribute('data-tone')).toBe('pending');
    expect(host.querySelector('[data-testid="browser-session-pick-error"]')?.textContent).toBe(
      'pick failed',
    );
    expect(host.querySelectorAll('[data-tone="error"]')).toHaveLength(2);
  });

  it('clears the highlight from its labelled pill', () => {
    const onClearHighlight = vi.fn();
    render({ clearHighlightLabel: 'Clear highlight', onClearHighlight });
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Clear highlight');
    act(() => button?.click());
    expect(onClearHighlight).toHaveBeenCalledOnce();
  });
});
