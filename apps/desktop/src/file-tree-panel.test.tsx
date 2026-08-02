// @vitest-environment happy-dom
/**
 * FileTreePanel component tests (Task 3: tree-first layout).
 *
 * Verifies:
 *  - Full-height tree renders without the split preview pane.
 *  - Clicking a file row calls onOpenFile with absolute + relative path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { FileTreePanel, type FileTreeRequest } from './file-tree-panel';
import type { HostResponse, ProjectListDirData } from '@piwin/contracts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function okList(
  entries: Array<{ name: string; relativePath: string; kind: 'file' | 'directory' }>,
): HostResponse {
  const data: ProjectListDirData = {
    projectPath: '/proj',
    relativePath: '',
    entries,
  };
  return {
    id: '1',
    type: 'response',
    command: 'project/list-dir',
    success: true,
    data,
  };
}

describe('FileTreePanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function renderPanel(props: {
    request: (command: FileTreeRequest) => Promise<HostResponse>;
    onOpenFile?: (absolutePath: string, relativePath: string) => void;
    onInsertPath?: (absolutePath: string, relativePath: string) => void;
  }): void {
    const tree: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <FileTreePanel
          projectPath="/proj"
          request={props.request}
          {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
          {...(props.onInsertPath ? { onInsertPath: props.onInsertPath } : {})}
        />
      </PiwinUiProvider>
    );
    act(() => {
      root.render(tree);
    });
  }

  function queryByTestId(testId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  it('renders full-height tree without split preview and opens file via callback', async () => {
    const onOpenFile = vi.fn();
    const request = vi.fn(async (cmd: FileTreeRequest): Promise<HostResponse> => {
      if (cmd.type === 'project/list-dir') {
        return okList([
          { name: 'README.md', relativePath: 'README.md', kind: 'file' },
          { name: 'src', relativePath: 'src', kind: 'directory' },
        ]);
      }
      return {
        id: '1',
        type: 'response',
        command: cmd.type,
        success: false,
        error: 'unexpected command',
      };
    });

    renderPanel({ request, onOpenFile });

    // Wait for the async list-dir to flush into the DOM.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const readmeRow = Array.from(document.querySelectorAll<HTMLElement>('.file-tree-row')).find(
      (row) => row.textContent?.includes('README.md'),
    );
    expect(readmeRow).toBeTruthy();

    // No split layout class, no preview pane.
    expect(document.querySelector('.file-tree-panel-split')).toBeNull();
    expect(queryByTestId('file-tree-preview')).toBeNull();

    act(() => {
      readmeRow?.click();
    });

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('/proj/README.md', 'README.md');
  });
});
