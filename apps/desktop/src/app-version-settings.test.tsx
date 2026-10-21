// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { DesktopLocaleProvider } from './desktop-locale-context.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type InstallResult = { kind: string; busySessionCount?: number } | Error;

const runtime = vi.hoisted(() => ({
  desktop: true,
  version: '0.2.5',
  check: undefined as unknown,
  installResults: [] as InstallResult[],
}));
const invoke = vi.hoisted(() =>
  vi.fn(async (command: string, args?: { force?: boolean }) => {
    if (command === 'app_update_check') return runtime.check;
    if (command === 'app_update_install') {
      void args;
      const result = runtime.installResults.shift() ?? { kind: 'restarting' };
      if (result instanceof Error) throw result.message;
      return result;
    }
    throw new Error(`unexpected ${command}`);
  }),
);
const openExternalUrl = vi.hoisted(() => vi.fn(async () => true));

vi.mock('./shell-runtime.js', () => ({ isDesktopTauriRuntime: () => runtime.desktop }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => runtime.version }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('./open-external-url.js', () => ({ openExternalUrl }));

let root: Root | undefined;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderCard(): Promise<HTMLDivElement> {
  // The update store is a module singleton: start each case from a clean one.
  vi.resetModules();
  const { AppVersionSettings } = await import('./app-version-settings.js');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <AppVersionSettings />
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    );
  });
  await flush();
  return container;
}

function button(testId: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  runtime.desktop = true;
  runtime.version = '0.2.5';
  runtime.check = undefined;
  runtime.installResults = [];
  invoke.mockClear();
  vi.restoreAllMocks();
  openExternalUrl.mockClear();
});

describe('AppVersionSettings', () => {
  it('offers one-click update when a newer bundle is published', async () => {
    runtime.check = { version: '0.2.6', currentVersion: '0.2.5', notes: null };
    const container = await renderCard();
    expect(container.textContent).toContain('当前版本 v0.2.5');
    expect(container.textContent).toContain('有新版本 v0.2.6');
    const updateNow = button('app-version-update-now');
    expect(updateNow?.textContent).toBe('立即更新');
    await act(async () => updateNow?.click());
    await flush();
    expect(invoke).toHaveBeenCalledWith('app_update_install', { force: false });
    expect(container.textContent).toContain('正在重启');
  });

  it('confirms before interrupting running sessions', async () => {
    runtime.check = { version: '0.2.6', currentVersion: '0.2.5' };
    runtime.installResults = [{ kind: 'busy', busySessionCount: 2 }, { kind: 'restarting' }];
    await renderCard();
    await act(async () => button('app-version-update-now')?.click());
    await flush();
    expect(document.body.textContent).toContain('有 2 个会话正在运行');
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (element) => element.textContent === '仍然更新',
    );
    await act(async () => confirm?.click());
    await flush();
    expect(invoke).toHaveBeenLastCalledWith('app_update_install', { force: true });
  });

  it('falls back to the download page when install fails', async () => {
    runtime.check = { version: '0.2.6', currentVersion: '0.2.5' };
    runtime.installResults = [new Error('read-only volume')];
    const container = await renderCard();
    await act(async () => button('app-version-update-now')?.click());
    await flush();
    expect(container.textContent).toContain('更新失败：read-only volume');
    const download = button('app-version-open-download');
    expect(download?.textContent).toBe('前往下载');
    act(() => download?.click());
    expect(openExternalUrl).toHaveBeenCalledWith('https://docs.piwinwin.com/download');
  });

  it('shows only the version when up to date or the check fails', async () => {
    const upToDate = await renderCard();
    expect(upToDate.textContent).toContain('当前版本 v0.2.5');
    expect(upToDate.textContent).not.toContain('有新版本');
    expect(button('app-version-open-download')?.textContent).toBe('查看更新日志');
    act(() => root?.unmount());
    invoke.mockRejectedValueOnce('offline');
    const offline = await renderCard();
    expect(offline.textContent).toContain('当前版本 v0.2.5');
  });

  it('labels a development build', async () => {
    runtime.version = '0.0.0';
    const container = await renderCard();
    expect(container.textContent).toContain('开发构建');
  });

  it('renders nothing outside the Desktop app', async () => {
    runtime.desktop = false;
    const container = await renderCard();
    expect(container.querySelector('[data-testid="app-version-settings"]')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
