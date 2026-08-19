/**
 * Session pack backup contracts (Cold Storage R1 PR1).
 *
 * R1 packs are non-destructive backups of one product session:
 * - transcript.sqlite3
 * - optional media tree for that session
 * - enough index metadata to recreate a stub later
 *
 * Destructive offload/import is intentionally out of this PR.
 */

import type { SessionScope } from './host.js';

export const PIWIN_SESSION_PACK_FORMAT = 'piwin-session-pack' as const;
export const PIWIN_SESSION_PACK_VERSION = 1 as const;
export const PIWIN_SESSION_PACK_SUFFIX = '.piwin-pack' as const;
export const PIWIN_SESSION_PACK_SIDECAR_SUFFIX = '.sha256' as const;

/** Safe Host-generated pack id grammar (single path segment). */
export const PIWIN_SESSION_PACK_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;

export type SessionPackMediaManifest =
  | {
      included: true;
      entryPrefix: string;
      byteLength: number;
      fileCount: number;
      treeSha256: string;
    }
  | {
      included: false;
      byteLength: 0;
      fileCount: 0;
    };

export type SessionPackManifestV1 = {
  format: typeof PIWIN_SESSION_PACK_FORMAT;
  version: typeof PIWIN_SESSION_PACK_VERSION;
  packId: string;
  createdAt: string;
  session: {
    id: string;
    name?: string;
    projectPath: string;
    scope?: SessionScope;
    workingDirectory?: string;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string;
    messageCount: number;
    lastPreview?: string;
    isPinned?: boolean;
    kind?: 'main' | 'subagent' | 'side-chat';
  };
  transcript: {
    entryPath: string;
    byteLength: number;
    sha256: string;
    messageCount: number;
  };
  media: SessionPackMediaManifest;
};

export type SessionPackCreateResultData = {
  packId: string;
  packPath: string;
  sidecarPath: string;
  sessionId: string;
  archiveSha256: string;
  transcriptSha256: string;
  mediaTreeSha256?: string;
  payloadBytes: number;
  mediaIncluded: boolean;
  createdAt: string;
};

export type SessionPackVerifyResultData = {
  packPath: string;
  sidecarPath: string;
  packId: string;
  sessionId: string;
  archiveSha256: string;
  transcriptSha256: string;
  mediaTreeSha256?: string;
  payloadBytes: number;
  mediaIncluded: boolean;
  messageCount: number;
  valid: true;
};

export type SessionPackListItem = {
  packId: string;
  packPath: string;
  sidecarPath: string;
  sessionId: string;
  payloadBytes: number;
  mediaIncluded: boolean;
  messageCount: number;
  createdAt: string;
  valid: boolean;
  error?: string;
};

export type SessionPackListData = {
  directory: string;
  packs: SessionPackListItem[];
};

export function isSafeSessionPackId(value: string): boolean {
  return PIWIN_SESSION_PACK_ID_PATTERN.test(value);
}

export function isSafeSessionPackSessionId(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  if (value === '.' || value === '..') {
    return false;
  }
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) {
    return false;
  }
  return true;
}

export function assertSafeSessionPackId(value: string): string {
  if (!isSafeSessionPackId(value)) {
    throw new Error(`Invalid pack id: ${value}`);
  }
  return value;
}

export function assertSafeSessionPackSessionId(value: string): string {
  if (!isSafeSessionPackSessionId(value)) {
    throw new Error(`Invalid pack session id: ${value}`);
  }
  return value;
}
