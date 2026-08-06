// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
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
});
