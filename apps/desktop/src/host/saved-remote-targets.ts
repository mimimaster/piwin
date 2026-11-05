/**
 * Saved legacy-attached remote Hosts: endpoints this Desktop reached through
 * the address + one-time-token flow, so switching back never needs the token
 * dance again. Endpoints only — reconnect auth comes from the device
 * credential vault (device-admission.ts); door tokens are deliberately not
 * persisted here.
 */
import { isDesktopRemoteHostEndpoint } from './remote-host-session.js';

export type SavedRemoteTarget = {
  endpoint: string;
  hostInstanceId?: string;
  savedAt: number;
};

const SAVED_TARGETS_KEY = 'piwin.desktop.saved-remote-targets';
/** A Desktop does not roam between dozens of Hosts; keep the list bounded. */
const MAX_SAVED_TARGETS = 8;

function readStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function parseEntry(item: unknown): SavedRemoteTarget | undefined {
  if (typeof item !== 'object' || item === null) {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  if (typeof record.endpoint !== 'string' || !isDesktopRemoteHostEndpoint(record.endpoint)) {
    return undefined;
  }
  const entry: SavedRemoteTarget = {
    endpoint: record.endpoint,
    savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
  };
  if (typeof record.hostInstanceId === 'string' && record.hostInstanceId.length > 0) {
    entry.hostInstanceId = record.hostInstanceId;
  }
  return entry;
}

function parse(raw: string | null | undefined): SavedRemoteTarget[] {
  if (raw === null || raw === undefined || raw.length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map(parseEntry)
    .filter((entry): entry is SavedRemoteTarget => entry !== undefined);
}

function write(entries: SavedRemoteTarget[]): void {
  readStorage()?.setItem(SAVED_TARGETS_KEY, JSON.stringify(entries));
}

export function listSavedRemoteTargets(): SavedRemoteTarget[] {
  return parse(readStorage()?.getItem(SAVED_TARGETS_KEY));
}

/** Upserts by endpoint, newest first; invalid endpoints are ignored. */
export function saveSavedRemoteTarget(input: {
  endpoint: string;
  hostInstanceId?: string;
}): SavedRemoteTarget[] {
  const endpoint = input.endpoint.trim();
  if (!isDesktopRemoteHostEndpoint(endpoint)) {
    return listSavedRemoteTargets();
  }
  const rest = listSavedRemoteTargets().filter((item) => item.endpoint !== endpoint);
  const entry: SavedRemoteTarget = { endpoint, savedAt: Date.now() };
  if (input.hostInstanceId !== undefined && input.hostInstanceId.length > 0) {
    entry.hostInstanceId = input.hostInstanceId;
  }
  const next = [entry, ...rest].slice(0, MAX_SAVED_TARGETS);
  write(next);
  return next;
}

export function removeSavedRemoteTarget(endpoint: string): SavedRemoteTarget[] {
  const next = listSavedRemoteTargets().filter((item) => item.endpoint !== endpoint.trim());
  write(next);
  return next;
}
