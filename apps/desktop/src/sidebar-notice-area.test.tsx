// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { getAppUpdateStore } from './app-update-store.js';
import { SidebarNoticeArea } from './sidebar-notice-area.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({ check: undefined as unknown }));
const invoke = vi.hoisted(() =>
  vi.fn(async (command: string) => {
    if (command === 'app_update_check') return runtime.check;
    if (command === 'app_update_install') return { kind: 'restarting' };
    throw new Error(`unexpected ${command}`);
  }),
);

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('./open-external-url.js', () => ({ openExternalUrl: vi.fn() }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function renderArea(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SidebarNoticeArea locale="zh-CN" />
      </PiwinUiProvider>,
    );
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  invoke.mockClear();
});

describe('SidebarNoticeArea', () => {
  it('takes no space without notices, then keeps the update card until it is installed', async () => {
    const view = await renderArea();
    expect(view.querySelector('[data-testid="sidebar-notices"]')).toBeNull();

    runtime.check = { version: '0.2.8', currentVersion: '0.2.7' };
    await act(async () => {
      await getAppUpdateStore().refresh();
    });
    const card = view.querySelector('[data-testid="sidebar-notice-app-update"]');
    expect(card?.textContent).toContain('piwin v0.2.8 可用');

    // Once the app runs the new version the check finds nothing newer.
    runtime.check = undefined;
    await act(async () => {
      await getAppUpdateStore().refresh();
    });
    expect(view.querySelector('[data-testid="sidebar-notices"]')).toBeNull();

    runtime.check = { version: '0.2.8', currentVersion: '0.2.7' };
    await act(async () => {
      await getAppUpdateStore().refresh();
    });
    const action = view.querySelector<HTMLButtonElement>(
      '[data-testid="sidebar-notice-app-update-action"]',
    );
    await act(async () => {
      action?.click();
    });
    expect(invoke).toHaveBeenCalledWith('app_update_install', { force: false });
    expect(view.textContent).toContain('更新已安装，正在重启…');
  });
});
