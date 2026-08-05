// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { MainErrorBanner } from './main-error-banner';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('MainErrorBanner', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders nothing when there is no error', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MainErrorBanner message={null} onDismiss={() => undefined} />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="main-error-banner"]')).toBeNull();
  });

  it('keeps the error tone and themed dismiss hook visible', () => {
    const onDismiss = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MainErrorBanner message="Provider unavailable" onDismiss={onDismiss} />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="main-error-banner"]')).not.toBeNull();
    expect(container.querySelector('[data-tone="error"]')).not.toBeNull();
    expect(container.textContent).toContain('Provider unavailable');
    expect(container.querySelector('.main-error-dismiss')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="main-error-dismiss"]')?.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
