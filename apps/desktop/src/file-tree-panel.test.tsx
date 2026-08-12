// @vitest-environment happy-dom
/**
 * FileTreePanel component tests.
 *
 * Verifies:
 *  - Tree-only layout until a file is opened.
 *  - Clicking a file opens an inline left/right split (preview | tree) inside the panel.
 *  - Directory rows are pure-text expand controls (no folder icon).
 *  - Optional onOpenFile still fires with absolute + relative path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { FileTreePanel, type FileTreeRequest } from './file-tree-panel';
import type { GitStatusData, HostResponse, ProjectListDirData } from '@piwin/contracts';

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
  let previousClipboard: Clipboard | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    previousClipboard = navigator.clipboard;
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
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: previousClipboard,
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function renderPanel(props: {
    request: (command: FileTreeRequest) => Promise<HostResponse>;
    onOpenFile?: (absolutePath: string, relativePath: string) => void;
    onInsertPath?: (absolutePath: string, relativePath: string) => void;
    onAddContextRef?: (ref: import('@piwin/contracts').PromptContextRef) => void;
  }): void {
    const tree: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <FileTreePanel
          projectPath="/proj"
          request={props.request}
          {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
          {...(props.onInsertPath ? { onInsertPath: props.onInsertPath } : {})}
          {...(props.onAddContextRef ? { onAddContextRef: props.onAddContextRef } : {})}
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
      if (cmd.type === 'project/read-file') {
        return {
          id: '2',
          type: 'response',
          command: 'project/read-file',
          success: true,
          data: {
            projectPath: '/proj',
            relativePath: 'README.md',
            absolutePath: '/proj/README.md',
            content: '# Hello\n\npreview body',
            byteSize: 20,
            truncated: false,
            isBinary: false,
            mimeHint: 'text/markdown',
          },
        };
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

    // Before open: no split layout class, no preview pane.
    expect(document.querySelector('.file-tree-panel-split')).toBeNull();
    expect(queryByTestId('file-tree-preview')).toBeNull();

    await act(async () => {
      readmeRow?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('/proj/README.md', 'README.md');

    // After open: split stays inside the file-tree panel (left content, right tree).
    const panel = queryByTestId('file-tree-panel');
    expect(panel?.className).toContain('file-tree-panel-split');
    expect(panel?.getAttribute('data-split')).toBe('true');
    expect(queryByTestId('file-tree-preview')).toBeTruthy();
    expect(queryByTestId('file-tree-browser')).toBeTruthy();
    expect(queryByTestId('file-tree-preview')?.textContent).toContain('preview body');

    // Directory row is pure text: no folder icon svg under the src row.
    const srcRow = Array.from(document.querySelectorAll<HTMLElement>('.file-tree-row')).find(
      (row) => row.textContent?.includes('src'),
    );
    expect(srcRow).toBeTruthy();
    expect(srcRow?.querySelector('.file-tree-icon')).toBeNull();
    expect(srcRow?.querySelector('.file-tree-twist')).toBeTruthy();
  });

  it('filters visible names by query', async () => {
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

    renderPanel({ request });

    // Wait for the async list-dir to flush into the DOM.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const filter = queryByTestId('file-tree-filter') as HTMLInputElement;
    expect(filter).toBeTruthy();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(filter, 'readme');
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.file-tree-row'));
    const readmeRow = rows.find((row) => row.textContent?.includes('README.md'));
    const srcRow = rows.find((row) => row.textContent?.includes('src'));
    expect(readmeRow).toBeTruthy();
    expect(srcRow).toBeUndefined();
  });

  it('ArrowDown then Enter opens file via onOpenFile', async () => {
    const onOpenFile = vi.fn();
    const request = vi.fn(async (cmd: FileTreeRequest): Promise<HostResponse> => {
      if (cmd.type === 'project/list-dir') {
        return okList([
          { name: 'README.md', relativePath: 'README.md', kind: 'file' },
          { name: 'main.ts', relativePath: 'main.ts', kind: 'file' },
        ]);
      }
      if (cmd.type === 'project/read-file') {
        return {
          id: '2',
          type: 'response',
          command: 'project/read-file',
          success: true,
          data: {
            projectPath: '/proj',
            relativePath: 'README.md',
            absolutePath: '/proj/README.md',
            content: 'readme content',
            byteSize: 14,
            truncated: false,
            isBinary: false,
          },
        };
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

    const list = container.querySelector('[role="tree"]') as HTMLUListElement;
    expect(list).toBeTruthy();

    act(() => {
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    await act(async () => {
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('/proj/README.md', 'README.md');
    expect(queryByTestId('file-tree-preview')).toBeTruthy();
  });

  it('shows M badge for a modified file from git/status', async () => {
    const request = vi.fn(async (cmd: FileTreeRequest): Promise<HostResponse> => {
      if (cmd.type === 'project/list-dir') {
        return okList([{ name: 'a.ts', relativePath: 'a.ts', kind: 'file' }]);
      }
      if (cmd.type === 'git/status') {
        const data: GitStatusData = {
          snapshot: {
            repository: { rootPath: '/proj', isRepository: true },
            branch: null,
            changedFiles: [{ path: 'a.ts', status: 'modified', staged: false, unstaged: true }],
            truncated: false,
            totalChangedFiles: 1,
          },
        };
        return {
          id: '2',
          type: 'response',
          command: 'git/status',
          success: true,
          data,
        };
      }
      return {
        id: '0',
        type: 'response',
        command: cmd.type,
        success: false,
        error: 'unexpected command',
      };
    });

    renderPanel({ request });

    // Wait for the async list-dir + git/status to flush into the DOM.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const badge = queryByTestId('file-tree-git-a.ts');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('M');
    expect(badge?.className).toContain('file-tree-git--modified');
  });

  it('leaves git status map empty when git/status fails (not a repo)', async () => {
    const request = vi.fn(async (cmd: FileTreeRequest): Promise<HostResponse> => {
      if (cmd.type === 'project/list-dir') {
        return okList([{ name: 'a.ts', relativePath: 'a.ts', kind: 'file' }]);
      }
      if (cmd.type === 'git/status') {
        return {
          id: '2',
          type: 'response',
          command: 'git/status',
          success: false,
          error: 'not a git repository',
        };
      }
      return {
        id: '0',
        type: 'response',
        command: cmd.type,
        success: false,
        error: 'unexpected command',
      };
    });

    renderPanel({ request });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // No badge should render when git status is unavailable.
    expect(queryByTestId('file-tree-git-a.ts')).toBeNull();
  });

  it('selects a file and copies its absolute path from the context menu', async () => {
    const writeText = vi.fn(async (_text: string): Promise<void> => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const request = vi.fn(async (cmd: FileTreeRequest): Promise<HostResponse> => {
      if (cmd.type === 'project/list-dir') {
        return okList([{ name: 'README.md', relativePath: 'README.md', kind: 'file' }]);
      }
      return {
        id: '0',
        type: 'response',
        command: cmd.type,
        success: false,
        error: 'unexpected command',
      };
    });

    renderPanel({ request, onAddContextRef: vi.fn() });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const readmeRow = Array.from(document.querySelectorAll<HTMLElement>('.file-tree-row')).find(
      (row) => row.textContent?.includes('README.md'),
    );
    expect(readmeRow).toBeTruthy();

    act(() => {
      readmeRow?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 20, clientY: 20 }),
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // CM catalog menu: Copy Absolute Path lives on the catalog item id.
    const copyItem = queryByTestId('context-menu-copy-absolute-path');
    expect(copyItem).toBeTruthy();

    await act(async () => {
      copyItem?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(writeText).toHaveBeenCalledWith('/proj/README.md');
  });
});

describe('FileTreePanel context menu (CM-05)', () => {
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
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function renderTree(
    request: (command: FileTreeRequest) => Promise<HostResponse>,
    handlers: {
      onAddContextRef?: (ref: import('@piwin/contracts').PromptContextRef) => void;
      onSendPreset?: (text: string, refs: import('@piwin/contracts').PromptContextRef[]) => void;
    } = {},
  ): void {
    const tree: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <FileTreePanel
          projectPath="/proj"
          request={request}
          locale="en"
          {...(handlers.onAddContextRef ? { onAddContextRef: handlers.onAddContextRef } : {})}
          {...(handlers.onSendPreset ? { onSendPreset: handlers.onSendPreset } : {})}
        />
      </PiwinUiProvider>
    );
    act(() => {
      root.render(tree);
    });
  }

  function createRequestMock(): (command: FileTreeRequest) => Promise<HostResponse> {
    return vi.fn(async (cmd: FileTreeRequest): Promise<HostResponse> => {
      if (cmd.type === 'project/list-dir') {
        return okList([
          { name: 'src', relativePath: 'src', kind: 'directory' },
          { name: 'a.ts', relativePath: 'src/a.ts', kind: 'file' },
          { name: 'README.md', relativePath: 'README.md', kind: 'file' },
        ]);
      }
      return {
        id: '1',
        type: 'response',
        command: cmd.type,
        success: false,
        error: 'not a git repo',
      };
    });
  }

  function rowFor(relativePath: string): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(
      `button.file-tree-row[title="${relativePath}"]`,
    );
  }

  function menuItem(testId: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  it('right-clicking a file row opens the catalog menu with CM testIds', async () => {
    renderTree(createRequestMock(), { onAddContextRef: () => undefined });
    await act(async () => {
      await Promise.resolve();
    });

    const fileRow = rowFor('src/a.ts');
    expect(fileRow).not.toBeNull();
    act(() => {
      fileRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(menuItem('context-menu-add-to-chat')).not.toBeNull();
    expect(menuItem('context-menu-ask-about')).not.toBeNull();
    expect(menuItem('context-menu-open')).not.toBeNull();
    expect(menuItem('context-menu-copy-relative-path')).not.toBeNull();
    expect(menuItem('context-menu-copy-absolute-path')).not.toBeNull();
    // Reveal is hidden (not shown disabled) until the OS reveal hook is wired.
    expect(menuItem('context-menu-reveal')).toBeNull();
  });

  it('Add to Chat on a file row emits a file ref', async () => {
    const onAddContextRef = vi.fn();
    renderTree(createRequestMock(), { onAddContextRef });
    await act(async () => {
      await Promise.resolve();
    });

    const fileRow = rowFor('src/a.ts');
    act(() => {
      fileRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    const addItem = menuItem('context-menu-add-to-chat') as HTMLElement | null;
    expect(addItem).not.toBeNull();
    act(() => {
      addItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAddContextRef).toHaveBeenCalledTimes(1);
    expect(onAddContextRef.mock.calls[0]?.[0]).toMatchObject({
      kind: 'file',
      projectPath: '/proj',
      relativePath: 'src/a.ts',
    });
  });

  it('Add to Chat on a folder row emits a folder ref', async () => {
    const onAddContextRef = vi.fn();
    renderTree(createRequestMock(), { onAddContextRef });
    await act(async () => {
      await Promise.resolve();
    });

    const folderRow = rowFor('src');
    expect(folderRow).not.toBeNull();
    act(() => {
      folderRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    const addItem = menuItem('context-menu-add-to-chat') as HTMLElement | null;
    expect(addItem).not.toBeNull();
    act(() => {
      addItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAddContextRef).toHaveBeenCalledTimes(1);
    expect(onAddContextRef.mock.calls[0]?.[0]).toMatchObject({
      kind: 'folder',
      projectPath: '/proj',
      relativePath: 'src',
    });
  });

  it('renders plain rows without context menus when onAddContextRef is absent', async () => {
    renderTree(createRequestMock());
    await act(async () => {
      await Promise.resolve();
    });

    const fileRow = rowFor('src/a.ts');
    act(() => {
      fileRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(document.body.querySelector('[data-testid^="file-tree-context-"]')).toBeNull();
  });

  it('selection menu on the code preview sends the Explain preset (CM-07)', async () => {
    const onAddContextRef = vi.fn();
    const onSendPreset = vi.fn();
    const request = vi.fn(async (cmd: FileTreeRequest): Promise<HostResponse> => {
      if (cmd.type === 'project/list-dir') {
        return okList([
          { name: 'package.json', relativePath: 'package.json', kind: 'file' },
          { name: 'src', relativePath: 'src', kind: 'directory' },
        ]);
      }
      if (cmd.type === 'project/read-file') {
        return {
          id: '2',
          type: 'response',
          command: 'project/read-file',
          success: true,
          data: {
            projectPath: '/proj',
            relativePath: 'package.json',
            absolutePath: '/proj/package.json',
            content: '{\n  "name": "demo"\n}\n',
            byteSize: 24,
            truncated: false,
            isBinary: false,
          },
        };
      }
      return {
        id: '1',
        type: 'response',
        command: cmd.type,
        success: false,
        error: 'unexpected command',
      };
    });

    renderTree(request, { onAddContextRef, onSendPreset });
    await act(async () => {
      await Promise.resolve();
    });

    // Open the file so the code preview (CodePreviewView) renders.
    const fileRow = rowFor('package.json');
    await act(async () => {
      fileRow?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const preview = document.querySelector('[data-testid="code-preview-view"]') as HTMLElement;
    expect(preview).not.toBeNull();

    // Simulate a text selection over the first preview row.
    const firstRowText = preview.querySelector('.code-preview-text') as HTMLElement;
    expect(firstRowText).not.toBeNull();
    const range = document.createRange();
    range.selectNodeContents(firstRowText);
    const selectionStub = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => 'name',
    } as unknown as Selection;
    vi.spyOn(window, 'getSelection').mockReturnValue(selectionStub);

    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    // The preview is remounted inside the Radix trigger once a selection
    // target exists — re-query, the old reference is detached.
    const wrappedPreview = document.querySelector(
      '[data-testid="code-preview-view"]',
    ) as HTMLElement | null;
    expect(wrappedPreview).not.toBeNull();
    act(() => {
      wrappedPreview?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
    });
    const explainItem = menuItem('context-menu-explain') as HTMLElement | null;
    expect(explainItem).not.toBeNull();
    act(() => {
      explainItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSendPreset).toHaveBeenCalledTimes(1);
    const [text, refs] = onSendPreset.mock.calls[0] as [
      string,
      import('@piwin/contracts').PromptContextRef[],
    ];
    expect(text).toContain('Explain the attached context');
    expect(refs).toEqual([
      expect.objectContaining({
        kind: 'file',
        projectPath: '/proj',
        relativePath: 'package.json',
        lineStart: 1,
        lineEnd: 1,
      }),
    ]);
    expect(onAddContextRef).toHaveBeenCalledTimes(1);
  });
});
