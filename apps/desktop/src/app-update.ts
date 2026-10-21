/**
 * Desktop side of the in-app update (ADR 0097). The Rust `app_update` module
 * checks the signed manifests, downloads, installs and restarts; this file is
 * the typed bridge to it. Payloads are parsed, never trusted as-is.
 */

export const DOWNLOAD_PAGE_URL = 'https://docs.piwinwin.com/download';
/** tauri.conf.json stays at this version in git; only release builds get a real one. */
export const DEVELOPMENT_BUILD_VERSION = '0.0.0';

const UPDATE_AVAILABLE_EVENT = 'app-update://available';
const UPDATE_PROGRESS_EVENT = 'app-update://progress';

export type AvailableAppUpdate = {
  version: string;
  currentVersion: string;
  notes?: string;
};

export type AppUpdateInstallOutcome =
  | { kind: 'busy'; busySessionCount: number }
  | { kind: 'noUpdate' }
  | { kind: 'restarting' };

export type AppUpdateProgress = {
  downloaded: number;
  total?: number;
  finished: boolean;
};

export type AppUpdateBridge = {
  check: () => Promise<AvailableAppUpdate | undefined>;
  install: (force: boolean) => Promise<AppUpdateInstallOutcome>;
  onAvailable: (listener: (update: AvailableAppUpdate) => void) => Promise<() => void>;
  onProgress: (listener: (progress: AppUpdateProgress) => void) => Promise<() => void>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseAvailableAppUpdate(value: unknown): AvailableAppUpdate | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const { version, currentVersion, notes } = record;
  if (typeof version !== 'string' || typeof currentVersion !== 'string') return undefined;
  return {
    version,
    currentVersion,
    ...(typeof notes === 'string' && notes.trim() ? { notes: notes.trim() } : {}),
  };
}

export function parseAppUpdateInstallOutcome(value: unknown): AppUpdateInstallOutcome {
  const record = asRecord(value);
  if (record?.kind === 'busy' && typeof record.busySessionCount === 'number') {
    return { kind: 'busy', busySessionCount: record.busySessionCount };
  }
  if (record?.kind === 'restarting') return { kind: 'restarting' };
  return { kind: 'noUpdate' };
}

export function parseAppUpdateProgress(value: unknown): AppUpdateProgress | undefined {
  const record = asRecord(value);
  if (!record || typeof record.downloaded !== 'number') return undefined;
  return {
    downloaded: record.downloaded,
    ...(typeof record.total === 'number' && record.total > 0 ? { total: record.total } : {}),
    finished: record.finished === true,
  };
}

/** Whole percent, or undefined while the size is unknown. */
export function appUpdatePercent(progress: AppUpdateProgress | undefined): number | undefined {
  if (!progress?.total) return undefined;
  return Math.min(100, Math.floor((progress.downloaded / progress.total) * 100));
}

export function createTauriAppUpdateBridge(): AppUpdateBridge {
  return {
    check: async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      return parseAvailableAppUpdate(await invoke('app_update_check'));
    },
    install: async (force) => {
      const { invoke } = await import('@tauri-apps/api/core');
      return parseAppUpdateInstallOutcome(await invoke('app_update_install', { force }));
    },
    onAvailable: async (listener) => {
      const { listen } = await import('@tauri-apps/api/event');
      return listen(UPDATE_AVAILABLE_EVENT, (event) => {
        const update = parseAvailableAppUpdate(event.payload);
        if (update) listener(update);
      });
    },
    onProgress: async (listener) => {
      const { listen } = await import('@tauri-apps/api/event');
      return listen(UPDATE_PROGRESS_EVENT, (event) => {
        const progress = parseAppUpdateProgress(event.payload);
        if (progress) listener(progress);
      });
    },
  };
}
