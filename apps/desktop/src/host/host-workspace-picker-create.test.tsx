// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCreateEntryInput, HostDirEntry, HostListDirData } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { HostWorkspacePicker } from './host-workspace-picker.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const homePath = '/Users/host';
let root: Root;
let container: HTMLDivElement;
let listings: Map<string, HostDirEntry[]>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  listings = new Map([
    [homePath, [{ name: 'existing.txt', path: `${homePath}/existing.txt`, kind: 'file' }]],
  ]);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function button(testId: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing button ${testId}`);
  return element;
}

async function openMenu(): Promise<void> {
  if (document.querySelector('[data-testid="host-workspace-file-menu"]')) return;
  await act(async () => {
    button('host-workspace-file-actions').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
}

async function selectAction(testId: string): Promise<void> {
  await openMenu();
  await act(async () => button(testId).click());
}

async function openContextMenu(path: string, entryPath?: string): Promise<void> {
  const column = [
    ...container.querySelectorAll<HTMLElement>('[data-testid="host-workspace-column"]'),
  ].find((element) => element.getAttribute('aria-label') === path);
  if (!column) throw new Error(`Missing column ${path}`);
  const entryRow = entryPath
    ? [...column.querySelectorAll<HTMLElement>('[data-host-entry-path]')].find(
        (element) => element.dataset['hostEntryPath'] === entryPath,
      )
    : undefined;
  if (entryPath && !entryRow) throw new Error(`Missing entry ${entryPath}`);
  await act(async () =>
    (entryRow?.querySelector('span') ?? entryRow ?? column).dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 140,
      }),
    ),
  );
}

async function changeName(name: string): Promise<void> {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(
      'input[data-testid="host-workspace-create-name"]',
    );
    if (!input) throw new Error('Missing creation input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(): Promise<void> {
  await act(async () => {
    const form = document.querySelector('.host-workspace-create-form');
    if (!form) throw new Error('Missing name form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function render(mode: 'directory' | 'file' = 'directory', rejected = false) {
  const listDirectory = vi.fn(
    async (requested?: string, hidden?: boolean): Promise<HostListDirData> => {
      const path = requested || homePath;
      return {
        path,
        homePath,
        parentPath: path.slice(0, path.lastIndexOf('/')) || '/',
        entries: (listings.get(path) ?? []).filter(
          (entry) => hidden || !entry.name.startsWith('.'),
        ),
      };
    },
  );
  const createEntry = vi.fn(async (input: HostCreateEntryInput): Promise<HostDirEntry> => {
    if (rejected) throw new Error('已存在同名文件或文件夹，请使用其他名称。');
    const entry: HostDirEntry = {
      name: input.name,
      path: `${input.parentPath}/${input.name}`,
      kind: input.kind,
    };
    const entries = listings.get(input.parentPath);
    if (!entries) throw new Error('Missing parent');
    entries.push(entry);
    if (entry.kind === 'directory') listings.set(entry.path, []);
    return entry;
  });
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  await act(async () => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <HostWorkspacePicker
          locale="zh-CN"
          mode={mode}
          currentPath=""
          onCurrentPathChange={() => undefined}
          listDirectory={listDirectory}
          createEntry={createEntry}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </PiwinUiProvider>,
    );
  });
  return { listDirectory, createEntry, onConfirm, onCancel };
}

describe('Host picker creation and file operations', () => {
  it('keeps the footer focused on selection and makes file actions keyboard accessible', async () => {
    await render();
    expect(container.querySelector('.host-workspace-footer')?.textContent).toBe('取消打开');
    expect(document.querySelector('[data-testid="host-workspace-new-folder"]')).toBeNull();
    await openMenu();
    expect(
      document.querySelector('[data-testid="host-workspace-file-menu"]')?.textContent,
    ).toContain('在「host」中');
    expect(button('host-workspace-new-folder').getAttribute('role')).toBe('menuitem');
  });

  it.each(['directory', 'file'] as const)(
    'creates a %s inside a right-clicked unopened subfolder',
    async (kind) => {
      const childPath = `${homePath}/child`;
      listings.get(homePath)?.push({ name: 'child', path: childPath, kind: 'directory' });
      listings.set(childPath, []);
      const { createEntry } = await render('file');
      await openContextMenu(homePath, childPath);
      expect(
        document.querySelector('[data-testid="host-workspace-context-menu"]')?.textContent,
      ).toContain('在「child」中');
      expect(
        container.querySelector<HTMLInputElement>('[data-testid="project-path-input"]')?.value,
      ).toBe(homePath);
      expect(document.querySelector('[data-testid="host-workspace-refresh"]')).toBeNull();
      await act(async () =>
        button(
          kind === 'directory' ? 'host-workspace-new-folder' : 'host-workspace-new-file',
        ).click(),
      );
      expect(document.querySelector('.host-workspace-create-location')?.textContent).toContain(
        childPath,
      );
      await changeName(kind === 'directory' ? 'nested' : 'child.txt');
      await submit();
      expect(createEntry).toHaveBeenCalledWith({
        parentPath: childPath,
        name: kind === 'directory' ? 'nested' : 'child.txt',
        kind,
      });
      expect(
        container.querySelector<HTMLInputElement>('[data-testid="project-path-input"]')?.value,
      ).toBe(kind === 'directory' ? `${childPath}/nested` : childPath);
      const selectedRows = [...container.querySelectorAll('.host-workspace-row.is-selected')];
      expect(selectedRows.at(-1)?.textContent).toContain(kind === 'directory' ? 'nested' : 'child.txt');
    },
  );

  it('uses a right-clicked file’s containing directory for creation', async () => {
    const { createEntry } = await render();
    await openContextMenu(homePath, `${homePath}/existing.txt`);
    expect(
      document.querySelector('[data-testid="host-workspace-context-menu"]')?.textContent,
    ).toContain('在「host」中');
    await act(async () => button('host-workspace-new-file').click());
    await changeName('sibling.txt');
    await submit();
    expect(createEntry).toHaveBeenCalledWith({
      parentPath: homePath,
      name: 'sibling.txt',
      kind: 'file',
    });
  });

  it('opens the right-clicked folder without creating an entry', async () => {
    const childPath = `${homePath}/child`;
    listings.get(homePath)?.push({ name: 'child', path: childPath, kind: 'directory' });
    listings.set(childPath, []);
    const { createEntry } = await render();
    await openContextMenu(homePath, childPath);
    await act(async () => button('host-workspace-context-open').click());
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="project-path-input"]')?.value,
    ).toBe(childPath);
    expect(createEntry).not.toHaveBeenCalled();
  });

  it('uses the invoked ancestor column for right-click creation and records the resulting navigation', async () => {
    listings.get(homePath)?.push({ name: 'child', path: `${homePath}/child`, kind: 'directory' });
    listings.set(`${homePath}/child`, []);
    const { createEntry } = await render('file');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="host-workspace-dir"]')?.click();
    });
    await openContextMenu(homePath);
    expect(
      document.querySelector('[data-testid="host-workspace-context-menu"]')?.textContent,
    ).toContain('在「host」中');
    await act(async () => button('host-workspace-new-file').click());
    expect(document.querySelector('.host-workspace-create-location')?.textContent).toContain(
      homePath,
    );
    await changeName('parent.txt');
    await submit();
    expect(createEntry).toHaveBeenCalledWith({
      parentPath: homePath,
      name: 'parent.txt',
      kind: 'file',
    });
    expect(container.querySelector('.host-workspace-row.is-selected')?.textContent).toContain(
      'parent.txt',
    );
    await act(async () => button('host-workspace-back').click());
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="project-path-input"]')?.value,
    ).toBe(`${homePath}/child`);
  });

  it('refreshes an ancestor column without moving away from the current folder', async () => {
    listings.get(homePath)?.push({ name: 'child', path: `${homePath}/child`, kind: 'directory' });
    listings.set(`${homePath}/child`, []);
    const { listDirectory } = await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="host-workspace-dir"]')?.click();
    });
    listings
      .get(homePath)
      ?.push({ name: 'external.txt', path: `${homePath}/external.txt`, kind: 'file' });
    listDirectory.mockClear();
    await openContextMenu(homePath);
    await act(async () => button('host-workspace-refresh').click());
    expect(listDirectory).toHaveBeenCalledExactlyOnceWith(homePath, false);
    expect(container.querySelectorAll('[data-testid="host-workspace-column"]')).toHaveLength(2);
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="project-path-input"]')?.value,
    ).toBe(`${homePath}/child`);
    expect(container.textContent).toContain('external.txt');
  });

  it('creates in the browsed directory even when another location is typed, then opens the new folder', async () => {
    const { createEntry, onConfirm } = await render();
    const pathInput = container.querySelector<HTMLInputElement>(
      '[data-testid="project-path-input"]',
    );
    if (!pathInput) throw new Error('Missing path');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        pathInput,
        '/other/typed',
      );
      pathInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await selectAction('host-workspace-new-folder');
    await changeName('新项目');
    await submit();
    expect(createEntry).toHaveBeenCalledWith({
      parentPath: homePath,
      name: '新项目',
      kind: 'directory',
    });
    expect(document.querySelector('[data-testid="host-workspace-create-dialog"]')).toBeNull();
    expect(pathInput.value).toBe(`${homePath}/新项目`);
    expect(container.querySelector('.host-workspace-row.is-selected')?.textContent).toContain(
      '新项目',
    );
    await act(async () => button('open-project-btn').click());
    expect(onConfirm).toHaveBeenCalledWith(`${homePath}/新项目`);
    await act(async () => button('host-workspace-back').click());
    expect(pathInput.value).toBe(homePath);
  });

  it.each(['directory', 'file'] as const)(
    'creates a file in %s mode, clears filters, shows hidden files, and selects the result',
    async (mode) => {
      const { createEntry, onConfirm } = await render(mode);
      const search = container.querySelector<HTMLInputElement>(
        '[data-testid="host-workspace-search"]',
      );
      if (!search) throw new Error('Missing search');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          search,
          'unmatched',
        );
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await selectAction('host-workspace-new-file');
      await changeName('.gitignore');
      await submit();
      expect(createEntry).toHaveBeenCalledWith({
        parentPath: homePath,
        name: '.gitignore',
        kind: 'file',
      });
      expect(search.value).toBe('');
      await openMenu();
      expect(button('host-workspace-hidden').getAttribute('aria-checked')).toBe('true');
      await act(async () =>
        button('host-workspace-hidden').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      );
      expect(container.querySelector('.host-workspace-row.is-selected')?.textContent).toContain(
        '.gitignore',
      );
      expect(button('host-workspace-back').disabled).toBe(true);
      await act(async () => button('open-project-btn').click());
      expect(onConfirm).toHaveBeenCalledWith(mode === 'file' ? `${homePath}/.gitignore` : homePath);
    },
  );

  it('keeps file selection and history on refresh and updates changed listings', async () => {
    const { onConfirm } = await render('file');
    await act(async () => {
      const row = container.querySelector<HTMLButtonElement>('[data-testid="host-workspace-file"]');
      if (!row) throw new Error('Missing file');
      row.click();
    });
    listings
      .get(homePath)
      ?.push({ name: 'external', kind: 'directory', path: `${homePath}/external` });
    await selectAction('host-workspace-refresh');
    expect(container.textContent).toContain('external');
    expect(button('host-workspace-back').disabled).toBe(true);
    await act(async () => button('open-project-btn').click());
    expect(onConfirm).toHaveBeenCalledWith(`${homePath}/existing.txt`);
  });

  it('clears selection when the selected file was removed before refresh', async () => {
    await render('file');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="host-workspace-file"]')?.click();
    });
    listings.set(homePath, []);
    await selectAction('host-workspace-refresh');
    expect(button('open-project-btn').disabled).toBe(true);
  });

  it('blocks invalid names and keeps the form open with the name on creation failure', async () => {
    const { createEntry, onConfirm } = await render('directory', true);
    await selectAction('host-workspace-new-file');
    await changeName('../escape');
    expect(button('host-workspace-create-submit').disabled).toBe(true);
    await submit();
    expect(createEntry).not.toHaveBeenCalled();
    await changeName('existing.txt');
    await submit();
    expect(document.body.textContent).toContain('已存在同名文件或文件夹');
    expect(
      document.querySelector<HTMLInputElement>('input[data-testid="host-workspace-create-name"]')
        ?.value,
    ).toBe('existing.txt');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels the name dialog without writing or closing the picker', async () => {
    const { createEntry, onCancel } = await render();
    await selectAction('host-workspace-new-folder');
    await act(async () => {
      const cancel = [
        ...document.querySelectorAll<HTMLButtonElement>('.host-workspace-create-buttons button'),
      ].find((item) => item.textContent?.includes('取消'));
      if (!cancel) throw new Error('Missing cancel');
      cancel.click();
    });
    expect(document.querySelector('[data-testid="host-workspace-create-dialog"]')).toBeNull();
    expect(createEntry).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(button('open-project-btn').disabled).toBe(false);
  });

  it('toggles existing hidden entries without changing navigation history', async () => {
    await render();
    listings.get(homePath)?.push({ name: '.env', kind: 'file', path: `${homePath}/.env` });
    expect(container.textContent).not.toContain('.env');
    await selectAction('host-workspace-hidden');
    expect(container.textContent).toContain('.env');
    await selectAction('host-workspace-hidden');
    expect(container.textContent).not.toContain('.env');
    expect(button('host-workspace-back').disabled).toBe(true);
  });
});
