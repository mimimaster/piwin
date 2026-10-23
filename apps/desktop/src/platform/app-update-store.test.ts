import { describe, expect, it, vi } from 'vitest';
import type {
  AppUpdateBridge,
  AppUpdateInstallOutcome,
  AppUpdateProgress,
  AvailableAppUpdate,
} from './app-update.js';
import { createAppUpdateStore } from './app-update-store.js';

const UPDATE: AvailableAppUpdate = { version: '0.2.6', currentVersion: '0.2.5' };

function createFakeBridge(options: {
  check?: AvailableAppUpdate | undefined;
  install?: () => Promise<AppUpdateInstallOutcome>;
}) {
  let emitAvailable: ((update: AvailableAppUpdate) => void) | undefined;
  let emitProgress: ((progress: AppUpdateProgress) => void) | undefined;
  const install = vi.fn(options.install ?? (async () => ({ kind: 'restarting' }) as const));
  const bridge: AppUpdateBridge = {
    check: async () => options.check,
    install,
    onAvailable: async (listener) => {
      emitAvailable = listener;
      return () => {
        emitAvailable = undefined;
      };
    },
    onProgress: async (listener) => {
      emitProgress = listener;
      return () => {
        emitProgress = undefined;
      };
    },
  };
  return {
    bridge,
    install,
    available: (update: AvailableAppUpdate) => emitAvailable?.(update),
    progress: (progress: AppUpdateProgress) => emitProgress?.(progress),
  };
}

describe('createAppUpdateStore', () => {
  it('takes updates from background events and manual checks', async () => {
    const fake = createFakeBridge({ check: undefined });
    const store = createAppUpdateStore(fake.bridge);
    await store.watch();
    fake.available(UPDATE);
    expect(store.getState()).toEqual({ status: 'idle', update: UPDATE });
    await store.refresh();
    expect(store.getState()).toEqual({ status: 'idle' });
  });

  it('downloads with progress and ends restarting', async () => {
    let finishInstall: (outcome: AppUpdateInstallOutcome) => void = () => {};
    const fake = createFakeBridge({
      check: UPDATE,
      install: () => new Promise((resolve) => (finishInstall = resolve)),
    });
    const store = createAppUpdateStore(fake.bridge);
    await store.watch();
    await store.refresh();
    const installing = store.install({ force: false, origin: 'settings' });
    expect(store.getState().status).toBe('preparing');
    fake.progress({ downloaded: 10, total: 100, finished: false });
    expect(store.getState()).toMatchObject({
      status: 'downloading',
      progress: { downloaded: 10, total: 100 },
    });
    // A background check during the download must not reset it.
    fake.available({ version: '0.2.7', currentVersion: '0.2.5' });
    expect(store.getState().update).toEqual(UPDATE);
    fake.progress({ downloaded: 0, finished: true });
    finishInstall({ kind: 'restarting' });
    await installing;
    expect(store.getState().status).toBe('restarting');
  });

  it('asks before interrupting busy sessions, then forces on confirm', async () => {
    const fake = createFakeBridge({
      check: UPDATE,
      install: async () => ({ kind: 'busy', busySessionCount: 2 }),
    });
    const store = createAppUpdateStore(fake.bridge);
    await store.refresh();
    await store.install({ force: false, origin: 'notice' });
    expect(store.getState()).toMatchObject({
      status: 'busy',
      origin: 'notice',
      busySessionCount: 2,
    });
    store.dismissPrompt();
    expect(store.getState()).toEqual({ status: 'idle', update: UPDATE });
    await store.install({ force: true, origin: 'notice' });
    expect(fake.install).toHaveBeenLastCalledWith(true);
  });

  it('keeps the update and the error when install fails', async () => {
    const fake = createFakeBridge({
      check: UPDATE,
      install: async () => {
        throw 'app is not writable';
      },
    });
    const store = createAppUpdateStore(fake.bridge);
    await store.refresh();
    await store.install({ force: false, origin: 'settings' });
    expect(store.getState()).toEqual({
      status: 'failed',
      origin: 'settings',
      update: UPDATE,
      error: 'app is not writable',
    });
  });

  it('never starts a second install while one is in flight', async () => {
    const fake = createFakeBridge({ check: UPDATE, install: () => new Promise(() => {}) });
    const store = createAppUpdateStore(fake.bridge);
    await store.refresh();
    void store.install({ force: false, origin: 'settings' });
    void store.install({ force: false, origin: 'notice' });
    expect(fake.install).toHaveBeenCalledTimes(1);
  });
});
