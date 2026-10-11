// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostListDirData } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
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
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><HostWorkspacePicker
          locale="zh-CN"
          currentPath=""
          onCurrentPathChange={onCurrentPathChange}
          listDirectory={listDirectory}
          onConfirm={onConfirm}
          onCancel={() => undefined}
        /></PiwinUiProvider>,
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
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><HostWorkspacePicker
          locale="en"
          currentPath=""
          onCurrentPathChange={() => undefined}
          listDirectory={async () => home}
          mode="file"
          onConfirm={onConfirm}
          onCancel={() => undefined}
        /></PiwinUiProvider>,
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
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><HostWorkspacePicker
          locale="zh-CN"
          currentPath=""
          onCurrentPathChange={() => undefined}
          listDirectory={listDirectory}
          onConfirm={onConfirm}
          onCancel={() => undefined}
        /></PiwinUiProvider>,
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

  it('opens a nested path as columns from home', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const listDirectory = vi.fn(async (path?: string) => {
      if (path === '/Users/host/Projects') {
        return projects;
      }
      return home;
    });

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><HostWorkspacePicker
          locale="zh-CN"
          currentPath="/Users/host/Projects"
          onCurrentPathChange={() => undefined}
          listDirectory={listDirectory}
          onConfirm={() => undefined}
          onCancel={() => undefined}
        /></PiwinUiProvider>,
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(container?.querySelectorAll('[data-testid="host-workspace-column"]').length).toBe(2);
      });
    });
    expect(listDirectory).toHaveBeenCalledWith('/Users/host/Projects', false);
    expect(listDirectory).toHaveBeenCalledWith('/Users/host', false);
    expect(container?.querySelector('.host-workspace-column.is-last')).toBeTruthy();
    expect(container?.querySelector('[data-testid="host-workspace-col-resizer"]')).toBeTruthy();
    expect(container?.querySelector('[data-testid="host-workspace-sidebar-resizer"]')).toBeTruthy();
    expect(container?.querySelector('[data-testid="host-workspace-dialog-resizer"]')).toBeTruthy();
    const selected = [...(container?.querySelectorAll('.host-workspace-row.is-selected') ?? [])];
    expect(selected.some((node) => node.textContent?.includes('Projects'))).toBe(true);
  });

  it('drops later columns when a file is selected', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const listDirectory = vi.fn(async (path?: string) => {
      if (path === '/Users/host/Projects') {
        return projects;
      }
      return home;
    });

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><HostWorkspacePicker
          locale="en"
          currentPath=""
          onCurrentPathChange={() => undefined}
          listDirectory={listDirectory}
          onConfirm={() => undefined}
          onCancel={() => undefined}
        /></PiwinUiProvider>,
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(container?.querySelector('[data-testid="host-workspace-dir"]')).toBeTruthy();
      });
    });
    const projectsFolder = [...(container?.querySelectorAll('[data-testid="host-workspace-dir"]') ?? [])].find(
      (node) => node.textContent?.includes('Projects'),
    );
    await act(async () => {
      (projectsFolder as HTMLButtonElement).click();
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(container?.querySelectorAll('[data-testid="host-workspace-column"]').length).toBe(2);
      });
    });

    const fileRow = [...(container?.querySelectorAll('[data-testid="host-workspace-file"]') ?? [])].find(
      (node) => node.textContent?.includes('readme.md'),
    );
    expect(fileRow).toBeTruthy();
    await act(async () => {
      (fileRow as HTMLButtonElement).click();
    });
    expect(container?.querySelectorAll('[data-testid="host-workspace-column"]').length).toBe(1);
  });

  it('widens a column when the divider is dragged', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const listDirectory = vi.fn(async (path?: string) => {
      if (path === '/Users/host/Projects') {
        return projects;
      }
      return home;
    });

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><HostWorkspacePicker
          locale="en"
          currentPath="/Users/host/Projects"
          onCurrentPathChange={() => undefined}
          listDirectory={listDirectory}
          onConfirm={() => undefined}
          onCancel={() => undefined}
        /></PiwinUiProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(container?.querySelector('[data-testid="host-workspace-col-resizer"]')).toBeTruthy();
      });
    });

    const resizer = container?.querySelector(
      '[data-testid="host-workspace-col-resizer"]',
    ) as HTMLDivElement;
    const column = resizer.parentElement as HTMLElement;
    await act(async () => {
      resizer.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientX: 200, pointerId: 1, bubbles: true }),
      );
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 260, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    });
    expect(column.style.minWidth).toBe('260px');
  });

  it('opens Host locations and moves to the parent without changing back/forward semantics', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const mounted = '/Volumes/Drive';
    const mountedProject = `${mounted}/Projects`;
    const listings: Record<string, HostListDirData> = {
      [home.path]: {
        ...home,
        locations: [
          { name: 'Computer', path: '/' },
          { name: 'Drive', path: mounted },
        ],
      },
      [mounted]: {
        path: mounted,
        parentPath: '/Volumes',
        homePath: home.path,
        entries: [{ name: 'Projects', kind: 'directory', path: mountedProject }],
      },
      [mountedProject]: {
        path: mountedProject,
        parentPath: mounted,
        homePath: home.path,
        entries: [],
      },
    };
    const listDirectory = vi.fn(async (path?: string) => listings[path ?? home.path] ?? home);

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><HostWorkspacePicker
          locale="en"
          currentPath=""
          onCurrentPathChange={() => undefined}
          listDirectory={listDirectory}
          onConfirm={() => undefined}
          onCancel={() => undefined}
        /></PiwinUiProvider>,
      );
    });
    const drive = container?.querySelector(
      '[data-testid="host-workspace-location"][title="/Volumes/Drive"]',
    ) as HTMLButtonElement;
    expect(drive).toBeTruthy();
    await act(async () => drive.click());
    expect(pathInputValue(container)).toBe(mounted);
    const projectsRow = container?.querySelector(
      '[data-testid="host-workspace-dir"]',
    ) as HTMLButtonElement;
    await act(async () => projectsRow.click());
    expect(pathInputValue(container)).toBe(mountedProject);
    await act(async () => {
      (container?.querySelector('[data-testid="host-workspace-up"]') as HTMLButtonElement).click();
    });
    expect(pathInputValue(container)).toBe(mounted);
    await act(async () => {
      (container?.querySelector('[data-testid="host-workspace-back"]') as HTMLButtonElement).click();
    });
    expect(pathInputValue(container)).toBe(mountedProject);
    await act(async () => {
      (container?.querySelector('[data-testid="host-workspace-forward"]') as HTMLButtonElement).click();
    });
    expect(pathInputValue(container)).toBe(mounted);
  });

  it('can move up from a deep path opened without visiting its ancestors', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const deepPath = '/Volumes/Drive/Projects/test';
    const parentPath = '/Volumes/Drive/Projects';
    const listDirectory = vi.fn(async (requested?: string): Promise<HostListDirData> => {
      if (requested === deepPath) {
        return { path: deepPath, parentPath, homePath: home.path, entries: [] };
      }
      if (requested === parentPath) {
        return {
          path: parentPath,
          parentPath: '/Volumes/Drive',
          homePath: home.path,
          entries: [{ name: 'test', path: deepPath, kind: 'directory' }],
        };
      }
      return home;
    });

    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><HostWorkspacePicker
          locale="zh-CN"
          currentPath={deepPath}
          onCurrentPathChange={() => undefined}
          listDirectory={listDirectory}
          onConfirm={() => undefined}
          onCancel={() => undefined}
        /></PiwinUiProvider>,
      );
    });
    expect(pathInputValue(container)).toBe(deepPath);
    expect(
      (container?.querySelector('[data-testid="host-workspace-back"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      (container?.querySelector('[data-testid="host-workspace-up"]') as HTMLButtonElement).click();
    });
    expect(pathInputValue(container)).toBe(parentPath);
    await act(async () => {
      (container?.querySelector('[data-testid="host-workspace-back"]') as HTMLButtonElement).click();
    });
    expect(pathInputValue(container)).toBe(deepPath);
  });
});
