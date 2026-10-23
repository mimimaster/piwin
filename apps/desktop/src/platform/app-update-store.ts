/**
 * One in-app update state shared by the startup notice and Settings →
 * General → Version (ADR 0097), so both show the same download and never
 * start two installs.
 */
import { useSyncExternalStore } from 'react';
import {
  createTauriAppUpdateBridge,
  type AppUpdateBridge,
  type AppUpdateProgress,
  type AvailableAppUpdate,
} from './app-update.js';

/** Where the install was started: each surface answers its own busy prompt. */
export type AppUpdateOrigin = 'notice' | 'settings';

export type AppUpdateState = {
  update?: AvailableAppUpdate;
  /** `preparing`: install requested, busy probe or download not started yet. */
  status: 'idle' | 'preparing' | 'busy' | 'downloading' | 'restarting' | 'failed';
  origin?: AppUpdateOrigin;
  busySessionCount?: number;
  progress?: AppUpdateProgress;
  error?: string;
};

export type AppUpdateStore = {
  getState: () => AppUpdateState;
  subscribe: (listener: () => void) => () => void;
  /** Starts listening to background checks; returns the unsubscribe. */
  watch: () => Promise<() => void>;
  refresh: () => Promise<void>;
  install: (options: { force: boolean; origin: AppUpdateOrigin }) => Promise<void>;
  dismissPrompt: () => void;
};

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

export function createAppUpdateStore(bridge: AppUpdateBridge): AppUpdateStore {
  let state: AppUpdateState = { status: 'idle' };
  const listeners = new Set<() => void>();

  function setState(next: AppUpdateState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function isInFlight(): boolean {
    return (
      state.status === 'preparing' ||
      state.status === 'downloading' ||
      state.status === 'restarting'
    );
  }

  function acceptUpdate(update: AvailableAppUpdate | undefined): void {
    if (isInFlight()) return;
    if (!update) {
      setState({ status: 'idle' });
      return;
    }
    // A newer check keeps a pending prompt only when it is about the same version.
    const sameVersion = state.update?.version === update.version;
    setState(sameVersion ? { ...state, update } : { status: 'idle', update });
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    watch: async () => {
      const stopAvailable = await bridge.onAvailable(acceptUpdate);
      const stopProgress = await bridge.onProgress((progress) => {
        if (state.status !== 'preparing' && state.status !== 'downloading') return;
        setState({ ...state, status: progress.finished ? 'restarting' : 'downloading', progress });
      });
      return () => {
        stopAvailable();
        stopProgress();
      };
    },
    refresh: async () => {
      acceptUpdate(await bridge.check());
    },
    install: async ({ force, origin }) => {
      if (isInFlight() || !state.update) return;
      const update = state.update;
      setState({ update, status: 'preparing', origin });
      try {
        const outcome = await bridge.install(force);
        if (outcome.kind === 'busy') {
          setState({ update, status: 'busy', origin, busySessionCount: outcome.busySessionCount });
        } else if (outcome.kind === 'noUpdate') {
          setState({ status: 'idle' });
        } else {
          setState({ ...state, status: 'restarting' });
        }
      } catch (error) {
        setState({ update, status: 'failed', origin, error: describeError(error) });
      }
    },
    dismissPrompt: () => {
      if (state.status === 'busy' || state.status === 'failed') {
        setState(state.update ? { status: 'idle', update: state.update } : { status: 'idle' });
      }
    },
  };
}

let sharedStore: AppUpdateStore | undefined;

export function getAppUpdateStore(): AppUpdateStore {
  sharedStore ??= createAppUpdateStore(createTauriAppUpdateBridge());
  return sharedStore;
}

export function useAppUpdateState(store: AppUpdateStore = getAppUpdateStore()): AppUpdateState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
