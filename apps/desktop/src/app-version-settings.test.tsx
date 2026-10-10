// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { DesktopLocaleProvider } from './desktop-locale-context.js';
import { AppVersionSettings } from './app-version-settings.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({ desktop: true, version: '0.1.1' }));
const openExternalUrl = vi.hoisted(() => vi.fn(async () => true));

vi.mock('./shell-runtime.js', () => ({ isDesktopTauriRuntime: () => runtime.desktop }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => runtime.version }));
vi.mock('./open-external-url.js', () => ({ openExternalUrl }));

const MAC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
let root: Root | undefined;

async function renderCard(latestMacVersion: string | undefined): Promise<HTMLDivElement> {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_USER_AGENT);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      latestMacVersion === undefined
        ? Promise.reject(new Error('offline'))
        : new Response(
            JSON.stringify({ latest: { 'macos-aarch64': { version: latestMacVersion } } }),
          ),
    ),
  );
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  runtime.desktop = true;
  runtime.version = '0.1.1';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  openExternalUrl.mockClear();
});

describe('AppVersionSettings', () => {
  it('shows the installed version and offers a newer release', async () => {
    const container = await renderCard('0.2.0');
    expect(container.textContent).toContain('当前版本 v0.1.1');
    expect(container.textContent).toContain('有新版本 v0.2.0');
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="app-version-open-download"]',
    );
    expect(button?.textContent).toBe('前往下载');
    act(() => button?.click());
    expect(openExternalUrl).toHaveBeenCalledWith('https://docs.piwinwin.com/download');
  });

  it('shows only the version when up to date or the manifest is unreachable', async () => {
    const upToDate = await renderCard('0.1.1');
    expect(upToDate.textContent).toContain('当前版本 v0.1.1');
    expect(upToDate.textContent).not.toContain('有新版本');
    act(() => root?.unmount());
    const offline = await renderCard(undefined);
    expect(offline.textContent).toContain('当前版本 v0.1.1');
    expect(offline.textContent).toContain('查看更新日志');
  });

  it('labels a development build and never checks for updates', async () => {
    runtime.version = '0.0.0';
    const container = await renderCard('9.9.9');
    expect(container.textContent).toContain('开发构建');
    expect(container.textContent).not.toContain('有新版本');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders nothing outside the Desktop app', async () => {
    runtime.desktop = false;
    const container = await renderCard('0.2.0');
    expect(container.querySelector('[data-testid="app-version-settings"]')).toBeNull();
  });
});
