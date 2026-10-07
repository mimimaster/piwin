// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostResponse, ProjectListDirData } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { FileTreePanel, type FileTreeRequest } from './file-tree-panel';
import { flattenVisibleNodes, type FileTreeNodeState } from './file-tree-model';
import { FILE_TREE_VIRTUALIZE_MIN_ROWS, shouldVirtualizeFileTree } from './file-tree-virtual-list';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const LIST_HEIGHT_PX = 480;
const ROW_HEIGHT_PX = 26;

function node(
  relativePath: string,
  kind: 'file' | 'directory',
  children: FileTreeNodeState[] | null = null,
  expanded = false,
): FileTreeNodeState {
  return {
    entry: { name: relativePath.split('/').pop() ?? relativePath, relativePath, kind },
    expanded,
    loading: false,
    children,
    error: null,
  } as FileTreeNodeState;
}

describe('flattenVisibleNodes', () => {
  it('lists expanded children in order with their depth and skips collapsed ones', () => {
    const tree = [
      node('src', 'directory', [node('src/a.ts', 'file'), node('src/lib', 'directory', [], true)], true),
      node('docs', 'directory', [node('docs/hidden.md', 'file')], false),
      node('README.md', 'file'),
    ];
    expect(
      flattenVisibleNodes(tree).map((row) => [row.node.entry.relativePath, row.depth]),
    ).toEqual([
      ['src', 0],
      ['src/a.ts', 1],
      ['src/lib', 1],
      ['docs', 0],
      ['README.md', 0],
    ]);
  });
});

describe('FileTreePanel virtualization gate', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    originalResizeObserver = window.ResizeObserver;
    class TestResizeObserver implements ResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      disconnect(): void {}
      observe(target: Element): void {
        this.callback(
          [
            {
              target,
              contentRect: target.getBoundingClientRect(),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this,
        );
      }
      unobserve(): void {}
    }
    window.ResizeObserver = TestResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver;
    const heightOf = (element: HTMLElement): number =>
      element.classList.contains('file-tree-list') ? LIST_HEIGHT_PX : ROW_HEIGHT_PX;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds(
      this: HTMLElement,
    ): DOMRect {
      const height = heightOf(this);
      return {
        top: 0,
        right: 280,
        bottom: height,
        left: 0,
        width: 280,
        height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
    for (const property of ['clientHeight', 'offsetHeight'] as const) {
      Object.defineProperty(HTMLElement.prototype, property, {
        configurable: true,
        get(this: HTMLElement) {
          return heightOf(this);
        },
      });
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    if (originalResizeObserver) {
      window.ResizeObserver = originalResizeObserver;
      globalThis.ResizeObserver = originalResizeObserver;
    }
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  async function renderWithFiles(count: number): Promise<HTMLElement> {
    const data: ProjectListDirData = {
      projectPath: '/proj',
      relativePath: '',
      entries: Array.from({ length: count }, (_, index) => ({
        name: `file-${index}.ts`,
        relativePath: `file-${index}.ts`,
        kind: 'file' as const,
      })),
    };
    const request = vi.fn(async (command: FileTreeRequest): Promise<HostResponse> => {
      if (command.type === 'project/list-dir') {
        return { id: '1', type: 'response', command: command.type, success: true, data };
      }
      return { id: '1', type: 'response', command: command.type, success: false, error: 'n/a' };
    });
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <FileTreePanel projectPath="/proj" request={request} locale="en" />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(container.querySelector('.file-tree-row')).not.toBeNull();
      });
    });
    const list = container.querySelector<HTMLElement>('.file-tree-list');
    if (list === null) throw new Error('file tree list did not render');
    return list;
  }

  it('keeps the nested tree below the threshold', async () => {
    const count = FILE_TREE_VIRTUALIZE_MIN_ROWS - 1;
    expect(shouldVirtualizeFileTree(count)).toBe(false);
    const list = await renderWithFiles(count);

    expect(list.dataset.virtualized).toBeUndefined();
    expect(list.querySelectorAll('.file-tree-row')).toHaveLength(count);
    expect(list.querySelector('.file-tree-virtual-spacer')).toBeNull();
  });

  it('mounts only the rows near the viewport for a large directory', async () => {
    const count = 1_200;
    const list = await renderWithFiles(count);

    expect(list.dataset.virtualized).toBe('true');
    const mounted = list.querySelectorAll('.file-tree-row');
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThanOrEqual(60);
    expect(list.querySelector('[title="file-0.ts"]')).not.toBeNull();
    expect(list.querySelector(`[title="file-${count - 1}.ts"]`)).toBeNull();
    expect(list.querySelector<HTMLElement>('.file-tree-virtual-spacer')?.style.height).toBe(
      `${count * ROW_HEIGHT_PX}px`,
    );
    expect(list.querySelector('.file-tree-node')?.getAttribute('aria-level')).toBe('1');
  });
});
