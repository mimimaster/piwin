// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateBridge, AppUpdateInstallOutcome, AvailableAppUpdate } from './app-update.js';
import { createAppUpdateStore } from './app-update-store.js';
import { connectAppUpdateNotice } from './app-update-notice.js';

const ui = vi.hoisted(() => ({ show: vi.fn(), hide: vi.fn() }));
vi.mock('@piwin/ui-kit', () => ({ showUiNotification: ui.show, hideUiNotification: ui.hide }));
vi.mock('./open-external-url.js', () => ({ openExternalUrl: vi.fn() }));

const UPDATE: AvailableAppUpdate = { version: '0.2.6', currentVersion: '0.2.5' };

function storeWith(install: () => Promise<AppUpdateInstallOutcome>) {
  const bridge: AppUpdateBridge = {
    check: async () => UPDATE,
    install: vi.fn(install),
    onAvailable: async () => () => {},
    onProgress: async () => () => {},
  };
  return createAppUpdateStore(bridge);
}

afterEach(() => {
  ui.show.mockClear();
  ui.hide.mockClear();
  localStorage.clear();
});

describe('connectAppUpdateNotice', () => {
  it('announces each version once, across launches', async () => {
    const first = storeWith(async () => ({ kind: 'restarting' }));
    const stop = connectAppUpdateNotice(first);
    await first.refresh();
    await first.refresh();
    expect(ui.show).toHaveBeenCalledTimes(1);
    expect(ui.show.mock.calls[0]?.[0]).toMatchObject({
      tone: 'info',
      autoClose: false,
      action: { label: '立即更新' },
    });
    stop();

    const relaunched = storeWith(async () => ({ kind: 'restarting' }));
    connectAppUpdateNotice(relaunched);
    await relaunched.refresh();
    expect(ui.show).toHaveBeenCalledTimes(1);
  });

  it('asks again from the notice when sessions are busy', async () => {
    const store = storeWith(async () => ({ kind: 'busy', busySessionCount: 1 }));
    connectAppUpdateNotice(store);
    await store.refresh();
    const action = ui.show.mock.calls[0]?.[0]?.action as { onClick: () => void };
    action.onClick();
    await vi.waitFor(() => expect(store.getState().status).toBe('busy'));
    const prompt = ui.show.mock.calls.at(-1)?.[0];
    expect(prompt).toMatchObject({ tone: 'warning', action: { label: '仍然更新' } });
    expect(String(prompt?.message)).toContain('1 个会话');
  });

  it('leaves busy prompts started from Settings to the Settings card', async () => {
    const store = storeWith(async () => ({ kind: 'busy', busySessionCount: 1 }));
    connectAppUpdateNotice(store);
    await store.refresh();
    ui.show.mockClear();
    await store.install({ force: false, origin: 'settings' });
    expect(ui.show).not.toHaveBeenCalled();
  });
});
