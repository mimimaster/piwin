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
    expect(chip?.classList.contains('ref')).toBe(true);
    expect(chip?.getAttribute('data-context-kind')).toBe('file');
    expect(chip?.textContent).toContain('a.ts');
    expect(chip?.textContent).toContain('file');
  });

  it('formats a file range as a code-selection capsule', () => {
    const ranged: PendingContextRefItem = {
      ...fileItem,
      key: 'file:/p:src/a.ts:20:55',
      ref: {
        kind: 'file',
        projectPath: '/p',
        relativePath: 'src/a.ts',
        lineStart: 20,
        lineEnd: 55,
        label: 'src/a.ts',
      },
    };
    const rendered = renderChip(<ContextRefChip item={ranged} />);
    root = rendered.root;
    container = rendered.container;

    expect(container.textContent).toContain('a.ts:20-55');
    expect(container.textContent).toContain('36 lines');
  });

  it('formats a text selection as a capsule', () => {
    const selection: PendingContextRefItem = {
      token: 'sel-1',
      key: 'selection:App.tsx:10:12:abc',
      ref: {
        kind: 'selection',
        relativePath: 'src/App.tsx',
        lineStart: 10,
        lineEnd: 12,
        snapshotText: 'const x = 1',
        label: 'Selected component',
      },
      label: 'Selected component',
    };
    const rendered = renderChip(<ContextRefChip item={selection} />);
    root = rendered.root;
    container = rendered.container;

    const chip = container.querySelector('[data-testid="composer-context-chip"]');
    expect(chip?.getAttribute('data-context-kind')).toBe('selection');
    expect(chip?.textContent).toContain('App.tsx:10-12');
    expect(chip?.textContent).toContain('selection');
  });

  it('formats a terminal snapshot as a terminal capsule', () => {
    const terminal: PendingContextRefItem = {
      token: 'term-1',
      key: 'terminal:abc',
      ref: {
        kind: 'terminal-output',
        snapshotText: 'error TS2304',
        label: 'tsc',
      },
      label: 'tsc',
    };
    const rendered = renderChip(<ContextRefChip item={terminal} />);
    root = rendered.root;
    container = rendered.container;

    const chip = container.querySelector('[data-testid="composer-context-chip"]');
    expect(chip?.getAttribute('data-context-kind')).toBe('terminal-output');
    expect(chip?.textContent).toContain('tsc');
    expect(chip?.textContent).toContain('terminal');
  });

  it('formats an error ref as a danger capsule', () => {
    const errorItem: PendingContextRefItem = {
      token: 'err-1',
      key: 'error:abc',
      ref: {
        kind: 'error',
        title: 'eslint',
        detail: 'Unexpected any',
        label: 'eslint',
      },
      label: 'eslint',
    };
    const rendered = renderChip(<ContextRefChip item={errorItem} />);
    root = rendered.root;
    container = rendered.container;

    const chip = container.querySelector('[data-testid="composer-context-chip"]');
    expect(chip?.getAttribute('data-context-kind')).toBe('error');
    expect(chip?.classList.contains('is-error')).toBe(true);
    expect(chip?.textContent).toContain('eslint');
    expect(chip?.textContent).toContain('error');
    expect(chip?.getAttribute('title')).toContain('Unexpected any');
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
