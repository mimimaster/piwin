/**
 * Session storage residency (Cold Storage R1 PR2).
 *
 * Orthogonal to archive lifecycle and runtime memory residency:
 * - `local` — transcript/media payload is on the Host
 * - `offloaded` — payload lives in a verified external pack; index keeps a stub
 * - `missing-pack` — stub says offloaded but the pack is not readable
 *
 * Missing `storage` on a record means local (legacy-compatible).
 */

import { PiwinError } from './piwin-error.js';

export const SESSION_STORAGE_STATES = ['local', 'offloaded', 'missing-pack'] as const;
export type SessionStorageState = (typeof SESSION_STORAGE_STATES)[number];

export type SessionStorageInfo = {
  state: SessionStorageState;
  packId?: string;
  packPath?: string;
  packArchiveSha256?: string;
  transcriptSha256?: string;
  mediaTreeSha256?: string;
  offloadedAt?: string;
  offloadedBytes?: number;
  coldPreview?: string;
};

/** Remote-safe storage projection: Host pack paths never cross this boundary. */
export type RemoteSessionStorageInfo = {
  state: SessionStorageState;
  packId?: string;
  offloadedAt?: string;
  offloadedBytes?: number;
  coldPreview?: string;
};

export const SESSION_BODY_OFFLOADED = 'session-body-offloaded';
export const SESSION_PACK_MISSING = 'session-pack-missing';
export const SESSION_STORAGE_BUSY = 'session-storage-busy';
export const SESSION_STORAGE_CONFLICT = 'session-storage-conflict';
export const SESSION_PACK_STALE = 'session-pack-stale';
export const SESSION_PACK_INVALID = 'session-pack-invalid';

export type SessionBodyOperation =
  | 'resume'
  | 'prompt'
  | 'transcript'
  | 'export'
  | 'truncate'
  | 'duplicate'
  | 'fork'
  | 'unarchive'
  | 'delete'
  | 'pack'
  | 'open-body';

export class SessionBodyUnavailableError extends PiwinError {
  readonly sessionId: string;
  readonly storageState: Exclude<SessionStorageState, 'local'>;
  readonly operation: string;

  constructor(input: {
    sessionId: string;
    storageState: Exclude<SessionStorageState, 'local'>;
    operation: string;
  }) {
    const code =
      input.storageState === 'missing-pack' ? SESSION_PACK_MISSING : SESSION_BODY_OFFLOADED;
    const action = describeSessionBodyOperation(input.operation);
    const hint =
      input.storageState === 'missing-pack'
        ? `supply a matching pack before ${action}`
        : `restore it from its pack before ${action}`;
    super(code, `${code}: Session "${input.sessionId}" is ${input.storageState}; ${hint}`, {
      category: 'validation',
    });
    this.sessionId = input.sessionId;
    this.storageState = input.storageState;
    this.operation = input.operation;
  }
}

export type SessionStorageFields = {
  storage?: SessionStorageInfo;
};

export function isSessionStorageState(value: unknown): value is SessionStorageState {
  return (
    value === 'local' || value === 'offloaded' || value === 'missing-pack'
  );
}

export function parseSessionStorageInfo(value: unknown): SessionStorageInfo | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isSessionStorageState(record.state)) {
    return undefined;
  }
  const info: SessionStorageInfo = { state: record.state };
  copyOptionalString(record, 'packId', info, 'packId');
  copyOptionalString(record, 'packPath', info, 'packPath');
  copyOptionalString(record, 'packArchiveSha256', info, 'packArchiveSha256');
  copyOptionalString(record, 'transcriptSha256', info, 'transcriptSha256');
  copyOptionalString(record, 'mediaTreeSha256', info, 'mediaTreeSha256');
  copyOptionalString(record, 'offloadedAt', info, 'offloadedAt');
  copyOptionalString(record, 'coldPreview', info, 'coldPreview');
  if (
    typeof record.offloadedBytes === 'number' &&
    Number.isFinite(record.offloadedBytes) &&
    record.offloadedBytes >= 0
  ) {
    info.offloadedBytes = record.offloadedBytes;
  }
  return info;
}

export function resolveSessionStorageState(
  record: SessionStorageFields | undefined | null,
): SessionStorageState {
  const parsed = parseSessionStorageInfo(record?.storage);
  return parsed?.state ?? 'local';
}

export function isSessionBodyAvailable(
  record: SessionStorageFields | undefined | null,
): boolean {
  return resolveSessionStorageState(record) === 'local';
}

export function assertSessionBodyAvailable(
  record: SessionStorageFields & { id: string },
  operation: string,
): void {
  const state = resolveSessionStorageState(record);
  if (state === 'local') {
    return;
  }
  throw new SessionBodyUnavailableError({
    sessionId: record.id,
    storageState: state,
    operation,
  });
}

export function projectRemoteSessionStorage(
  storage: SessionStorageInfo | undefined,
): RemoteSessionStorageInfo | undefined {
  const parsed = parseSessionStorageInfo(storage);
  if (!parsed || parsed.state === 'local') {
    return undefined;
  }
  const remote: RemoteSessionStorageInfo = { state: parsed.state };
  if (parsed.packId) remote.packId = parsed.packId;
  if (parsed.offloadedAt) remote.offloadedAt = parsed.offloadedAt;
  if (parsed.offloadedBytes !== undefined) remote.offloadedBytes = parsed.offloadedBytes;
  if (parsed.coldPreview) remote.coldPreview = parsed.coldPreview;
  return remote;
}

function describeSessionBodyOperation(operation: string): string {
  switch (operation) {
    case 'resume':
      return 'resume';
    case 'prompt':
      return 'prompt';
    case 'transcript':
      return 'reading the transcript';
    case 'export':
      return 'export';
    case 'truncate':
      return 'truncate';
    case 'duplicate':
      return 'duplicate';
    case 'fork':
      return 'fork';
    case 'unarchive':
      return 'unarchive';
    case 'delete':
      return 'delete';
    case 'pack':
      return 'packing';
    default:
      return 'opening the session body';
  }
}

function copyOptionalString(
  source: Record<string, unknown>,
  key: string,
  target: SessionStorageInfo,
  targetKey: keyof SessionStorageInfo,
): void {
  const value = source[key];
  if (typeof value === 'string' && value.length > 0) {
    (target as Record<string, unknown>)[targetKey] = value;
  }
}
