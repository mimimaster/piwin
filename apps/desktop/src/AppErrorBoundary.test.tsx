// @vitest-environment happy-dom
/**
 * The shell boundary is the last resort: recovery must be possible without a
 * window reload, because a reload drops the live session view.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { AppErrorBoundary } from './AppErrorBoundary';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function mount(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  const entry = { container, root };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  while (mounted.length > 0) {
    const render = mounted.pop();
    if (!render) continue;
    try {
      act(() => render.root.unmount());
    } catch {
      /* already unmounted */
    }
    render.container.remove();
  }
  vi.restoreAllMocks();
});

describe('AppErrorBoundary', () => {
  it('takes over the window when a child throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Boom(): ReactElement {
      throw new Error('transient render failure');
    }
    const { container } = mount(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(container.querySelector('[data-testid="app-error-boundary"]')).not.toBeNull();
    expect(container.textContent).toContain('transient render failure');
    expect(container.querySelector('[data-testid="app-error-retry"]')).not.toBeNull();
    // Packaged builds have no devtools; the card itself must point at the
    // component that threw.
    expect(container.querySelector('.permission-detail')?.textContent).toContain('Boom');
    consoleError.mockRestore();
  });

  it('retries in place so a transient crash does not force a window reload', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;
    function Flaky(): ReactElement {
      if (shouldThrow) throw new Error('once');
      return <p data-testid="recovered-shell">shell back</p>;
    }
    const { container } = mount(
      <AppErrorBoundary>
        <Flaky />
      </AppErrorBoundary>,
    );
    expect(container.querySelector('[data-testid="app-error-boundary"]')).not.toBeNull();

    shouldThrow = false;
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="app-error-retry"]')?.click();
    });

    expect(container.querySelector('[data-testid="app-error-boundary"]')).toBeNull();
    expect(container.querySelector('[data-testid="recovered-shell"]')?.textContent).toBe(
      'shell back',
    );
    consoleError.mockRestore();
  });

  it('re-catches when the retry fails again', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function AlwaysBoom(): ReactElement {
      throw new Error('still broken');
    }
    const { container } = mount(
      <AppErrorBoundary>
        <AlwaysBoom />
      </AppErrorBoundary>,
    );
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="app-error-retry"]')?.click();
    });
    expect(container.querySelector('[data-testid="app-error-boundary"]')).not.toBeNull();
    expect(container.textContent).toContain('still broken');
    consoleError.mockRestore();
  });
});
