// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ContextRefChip } from './context-ref-chip';
import type { PendingContextRefItem } from './hooks/use-composer-context-refs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderChip(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>,
    );
  });
  return { container, root };
}

const fileItem: PendingContextRefItem = {
  token: 'chip-token-1',
  key: 'file:/p:src/a.ts::',
  ref: { kind: 'file', projectPath: '/p', relativePath: 'src/a.ts', label: 'src/a.ts' },
  label: 'src/a.ts',
};

describe('ContextRefChip', () => {
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

  it('renders label and kind affordance with a stable testid', () => {
    const rendered = renderChip(<ContextRefChip item={fileItem} />);
    root = rendered.root;
    container = rendered.container;

    const chip = container.querySelector('[data-testid="composer-context-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-context-kind')).toBe('file');
    expect(chip?.textContent).toContain('src/a.ts');
    expect(chip?.textContent).toContain('file');
  });

  it('shows no remove button without an onRemove handler', () => {
    const rendered = renderChip(<ContextRefChip item={fileItem} />);
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-context-chip-remove"]')).toBeNull();
  });

  it('calls onRemove with the item key when remove is clicked', () => {
    const onRemove = vi.fn();
    const rendered = renderChip(<ContextRefChip item={fileItem} onRemove={onRemove} />);
    root = rendered.root;
    container = rendered.container;

    const removeButton = container.querySelector(
      '[data-testid="composer-context-chip-remove"]',
    ) as HTMLButtonElement | null;
    expect(removeButton).not.toBeNull();
    act(() => {
      removeButton?.click();
    });
    expect(onRemove).toHaveBeenCalledWith('file:/p:src/a.ts::');
  });
});
