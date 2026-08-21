// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { RuntimeTargetChip } from './runtime-target-chip';
import { DesktopLocaleProvider } from './desktop-locale-context';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderChip(node: ReactElement, locale: 'zh-CN' | 'en' = 'zh-CN'): {
  container: HTMLElement;
  root: Root;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale={locale} onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
  });
  return { container, root };
}

describe('RuntimeTargetChip', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
    root = null;
    container = null;
  });

  it('renders plain-text Local trigger', () => {
    const rendered = renderChip(<RuntimeTargetChip />, 'zh-CN');
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector(
      '[data-testid="composer-runtime-target"]',
    ) as HTMLButtonElement | null;
    const local = container.querySelector(
      '[data-testid="composer-runtime-local"]',
    ) as HTMLElement | null;

    expect(trigger).not.toBeNull();
    expect(trigger?.className).toContain('composer-context-link');
    expect(local?.textContent).toContain('本机');
  });

  it('shows This Mac in English', () => {
    const rendered = renderChip(<RuntimeTargetChip />, 'en');
    root = rendered.root;
    container = rendered.container;
    const local = container.querySelector(
      '[data-testid="composer-runtime-local"]',
    ) as HTMLElement | null;
    expect(local?.textContent).toContain('This Mac');
  });

  it('shows Remote Host as the active trigger when a remote target is connected', () => {
    const rendered = renderChip(<RuntimeTargetChip remoteConnected />, 'zh-CN');
    root = rendered.root;
    container = rendered.container;

    const remote = container.querySelector(
      '[data-testid="composer-runtime-remote"]',
    ) as HTMLElement | null;
    expect(remote?.textContent).toContain('远程 Host');
  });

  it('keeps Local available to switch back when remote is connected', () => {
    const onSelectLocal = vi.fn();
    const rendered = renderChip(
      <RuntimeTargetChip remoteConnected onSelectLocal={onSelectLocal} />,
      'zh-CN',
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector(
      '[data-testid="composer-runtime-target"]',
    ) as HTMLButtonElement | null;
    act(() => {
      trigger?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
      );
    });

    const localItem = document.querySelector(
      '[data-testid="composer-runtime-local-item"]',
    ) as HTMLElement | null;
    expect(localItem).not.toBeNull();
    expect(localItem?.hasAttribute('data-disabled')).toBe(false);

    act(() => {
      localItem?.click();
    });
    expect(onSelectLocal).toHaveBeenCalledOnce();
  });

  it('offers attach when running on the local sidecar', () => {
    const onSelectAttach = vi.fn();
    const rendered = renderChip(<RuntimeTargetChip onSelectAttach={onSelectAttach} />, 'zh-CN');
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector(
      '[data-testid="composer-runtime-target"]',
    ) as HTMLButtonElement | null;
    act(() => {
      trigger?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
      );
    });

    const attachItem = document.querySelector(
      '[data-testid="composer-runtime-attach-item"]',
    ) as HTMLElement | null;
    expect(attachItem).not.toBeNull();
    expect(attachItem?.hasAttribute('data-disabled')).toBe(false);
    act(() => {
      attachItem?.click();
    });
    expect(onSelectAttach).toHaveBeenCalledOnce();
  });
});
