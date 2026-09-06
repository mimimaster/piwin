// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostListDirData } from '@piwin/contracts';
import { HostWorkspacePicker } from './host-workspace-picker';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const home: HostListDirData = {
  path: '/Users/host',
  parentPath: '/Users',
  homePath: '/Users/host',
  entries: [
    { name: 'Projects', kind: 'directory', path: '/Users/host/Projects' },
    { name: 'Developer', kind: 'directory', path: '/Users/host/Developer' },
    { name: 'readme.md', kind: 'file', path: '/Users/host/readme.md' },
  ],
};

const projects: HostListDirData = {
  path: '/Users/host/Projects',
  parentPath: '/Users/host',
  homePath: '/Users/host',
  entries: [{ name: 'piwin', kind: 'directory', path: '/Users/host/Projects/piwin' }],
};

function pathInputValue(container: HTMLDivElement | null): string {
  return (container?.querySelector('[data-testid="project-path-input"]') as HTMLInputElement | null)
    ?.value ?? '';
}

describe('HostWorkspacePicker', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('lists Host folders in a column and opens the next column', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const listDirectory = vi.fn(async (path?: string) => {
      if (path === '/Users/host/Projects') {
        return projects;
      }
      return home;
    });
    const onCurrentPathChange = vi.fn();
    const onConfirm = vi.fn();

    await act(async () => {
      root?.render(
        <HostWorkspacePicker
          locale="zh-CN"
          currentPath=""
          onCurrentPathChange={onCurrentPathChange}
          listDirectory={listDirectory}
          onConfirm={onConfirm}
          onCancel={() => undefined}
        />,
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(pathInputValue(container)).toBe('/Users/host');
      });
    });
    expect(onCurrentPathChange).toHaveBeenCalledWith('/Users/host');
    const folders = [...(container?.querySelectorAll('[data-testid="host-workspace-dir"]') ?? [])];
    expect(folders.length).toBe(2);
    const projectsFolder = folders.find((node) => node.textContent?.includes('Projects'));
    expect(projectsFolder).toBeTruthy();

    await act(async () => {
      (projectsFolder as HTMLButtonElement).click();
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(pathInputValue(container)).toBe('/Users/host/Projects');
      });
    });
    expect(onCurrentPathChange).toHaveBeenCalledWith('/Users/host/Projects');
    expect(container?.querySelectorAll('[data-testid="host-workspace-column"]').length).toBe(2);

    await act(async () => {
      (container?.querySelector('[data-testid="open-project-btn"]') as HTMLButtonElement).click();
    });
    expect(onConfirm).toHaveBeenCalledWith('/Users/host/Projects');
  });

  it('confirms a file in file mode', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onConfirm = vi.fn();

    await act(async () => {
      root?.render(
        <HostWorkspacePicker
          locale="en"
          currentPath=""
          onCurrentPathChange={() => undefined}
          listDirectory={async () => home}
          mode="file"
          onConfirm={onConfirm}
          onCancel={() => undefined}
        />,
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(container?.querySelector('[data-testid="host-workspace-file"]')).toBeTruthy();
      });
    });

    const fileRow = [...(container?.querySelectorAll('[data-testid="host-workspace-file"]') ?? [])].find(
      (node) => node.textContent?.includes('readme.md'),
    );
    expect(fileRow).toBeTruthy();
    await act(async () => {
      (fileRow as HTMLButtonElement).click();
    });
    await act(async () => {
      (container?.querySelector('[data-testid="open-project-btn"]') as HTMLButtonElement).click();
    });
    expect(onConfirm).toHaveBeenCalledWith('/Users/host/readme.md');
    expect(container?.querySelector('[data-testid="open-project-btn"]')?.textContent).toBe('Choose');
  });

  it('opens the path typed in the location field', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onConfirm = vi.fn();
    const listDirectory = vi.fn(async (path?: string) => {
      if (path === '/tmp/typed-workspace') {
        return {
          path: '/tmp/typed-workspace',
          parentPath: '/tmp',
          homePath: '/Users/host',
          entries: [],
        };
      }
      return home;
    });

    await act(async () => {
      root?.render(
        <HostWorkspacePicker
          locale="zh-CN"
          currentPath=""
          onCurrentPathChange={() => undefined}
          listDirectory={listDirectory}
          onConfirm={onConfirm}
          onCancel={() => undefined}
        />,
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(pathInputValue(container)).toBe('/Users/host');
      });
    });

    const pathInput = container?.querySelector('[data-testid="project-path-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(pathInput, '/tmp/typed-workspace');
      pathInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (container?.querySelector('[data-testid="open-project-btn"]') as HTMLButtonElement).click();
    });
    expect(onConfirm).toHaveBeenCalledWith('/tmp/typed-workspace');
  });
});
