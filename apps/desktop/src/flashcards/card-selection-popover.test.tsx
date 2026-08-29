// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { CardSelectionPopover } from './card-selection-popover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CardSelectionPopover', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderPopover(overrides: {
    onInvoke?: () => void;
    onDismiss?: () => void;
    restoreFocus?: () => void;
    face?: 'front' | 'back';
  } = {}): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <CardSelectionPopover
            open={true}
            locale="zh-CN"
            face={overrides.face ?? 'front'}
            getAnchorRect={() => new DOMRect(10, 20, 40, 12)}
            onInvoke={overrides.onInvoke ?? (() => undefined)}
            onDismiss={overrides.onDismiss ?? (() => undefined)}
            {...(overrides.restoreFocus ? { restoreFocus: overrides.restoreFocus } : {})}
          />
        </PiwinUiProvider>,
      );
    });
  }

  function primary(): HTMLButtonElement {
    const button = document.querySelector('[data-testid="card-selection-primary"]');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('expected selection primary');
    }
    return button;
  }

  it('invokes on Enter and Space', () => {
    const onInvoke = vi.fn();
    renderPopover({ onInvoke });
    expect(primary().textContent).toMatch(/给我提示/);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    });
    expect(onInvoke).toHaveBeenCalledTimes(2);
  });

  it('dismisses on Escape and restores card focus', () => {
    const onDismiss = vi.fn();
    const restoreFocus = vi.fn();
    renderPopover({ onDismiss, restoreFocus, face: 'back' });
    expect(primary().textContent).toMatch(/讲解/);
    expect(primary().textContent).not.toMatch(/给我提示/);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('dismisses on outside pointer down via onOpenChange', () => {
    const onDismiss = vi.fn();
    renderPopover({ onDismiss });
    const content = document.querySelector('[data-testid="card-selection-popover"]');
    expect(content).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows a visible focus ring class on the primary action', () => {
    renderPopover();
    const button = primary();
    act(() => {
      button.focus();
    });
    expect(document.activeElement).toBe(button);
    expect(button.classList.contains('fc-sel-primary')).toBe(true);
  });
});
