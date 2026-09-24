/**
 * Trusted-domain read-only text preview (ADR 0052 Slice 3).
 *
 * Addressed by a config-root-relative path only — never a host-absolute
 * path — so remote clients can preview `~/.piwin/**` text without learning
 * or forging Host filesystem layout. Media vault bytes stay on `media/read`.
 *
 * Slice 4 (`preview/read-local-file`) is a local-Host-only user-gesture
 * channel: clicking a path previews whatever the UI can render (raster
 * image → session media vault; text → read-only document). Remote clients
 * must not send this command (host-server rejects it).
 */

import type { SavedMediaAsset } from './media.js';
import type { DocumentTargetRef } from './skills.js';

export type TrustedTextReadCommandInput = {
  /** Posix-style path relative to the Host config root (`~/.piwin`). */
  relativePath: string;
  /** Soft cap in bytes; Host may enforce a lower hard max. */
  maxBytes?: number;
};

/**
 * Stable failure reasons for preview/read-trusted-text.
 * Remote-safe: neither variant carries a host-absolute path.
 */
export type TrustedTextReadFailureReason =
  | 'not-found'
  | 'outside-config-root'
  | 'media-vault'
  | 'not-a-file'
  | 'binary'
  | 'too-large'
  | 'invalid-request';

export type TrustedTextReadData =
  | {
      status: 'ready';
      relativePath: string;
      displayRef: string;
      content: string;
      byteSize: number;
      truncated: boolean;
      readOnly: true;
    }
  | {
      status: 'unavailable';
      reason: TrustedTextReadFailureReason;
      displayRef: string;
      suggestion?: string;
    };

/**
 * Host-side document path resolution (ADR 0052 §6).
 *
 * A clicked path used to be interpreted by the client (markdown layer, chip
 * layer, open planner, alias retry) and by the Host (tool targets, local read,
 * config read) at the same time. Every new spelling had to be taught to each
 * interpreter, and whichever one missed answered `not-found` — hiding the real
 * cause. The Host now owns the single interpretation: it knows the host user's
 * home, its own config root, realpath aliases, and whether it is the local
 * shell. Clients send the raw path once and dispatch on the answer.
 */
export type DocumentTargetRoute =
  | 'media'
  | 'skill'
  | 'project'
  | 'trusted-config'
  | 'local-file'
  | 'find-file';

/** One route that was tried, with a stable reason code (never parsed as prose). */
export type DocumentPathAttempt = {
  route: DocumentTargetRoute;
  reason: string;
  /** Project-relative form when the route learned one (diagnostics only). */
  detail?: string;
};

/** Stable failure reasons for `preview/resolve-path` (UI maps to copy). */
export type DocumentPathFailureReason =
  | 'empty-path'
  | 'invalid-path'
  | 'not-found'
  | 'not-a-file'
  | 'outside-domains'
  | 'ambiguous-file'
  | 'project-root-missing'
  /** A local shell may open host paths; a remote client may not. */
  | 'remote-local-path-denied';

export type DocumentPathResolveCommandInput = {
  sessionId?: string;
  /** Active workspace root, when the shell has one. */
  projectPath?: string;
  /** Exactly what the user clicked, unstripped and unexpanded. */
  rawPath: string;
};

export type DocumentPathResolveData =
  | {
      status: 'resolved';
      target: DocumentTargetRef;
      /** Kept for the diagnostic disclosure even on success. */
      attempts: DocumentPathAttempt[];
    }
  | {
      status: 'unresolved';
      reason: DocumentPathFailureReason;
      attempts: DocumentPathAttempt[];
    };

/**
 * Whether a local-file attempt reports what the Host found on its own disk.
 * A remote client must not learn that: the refusal says the channel is closed,
 * not whether the path exists.
 */
const LOCAL_FILE_DISK_REASONS = new Set(['exists', 'no-such-file', 'not-a-file']);

/**
 * A `local-file` answer for a remote client. Resolved or not, the Host has
 * already looked at its own disk by the time it answers, and that look is
 * exactly what must not cross the wire: neither the path nor whether it
 * exists. The client learns only that the channel is closed.
 */
export function denyRemoteLocalFileTarget(data: DocumentPathResolveData): DocumentPathResolveData {
  const probedDisk = data.attempts.some(
    (attempt) => attempt.route === 'local-file' && LOCAL_FILE_DISK_REASONS.has(attempt.reason),
  );
  if (!probedDisk && (data.status !== 'resolved' || data.target.kind !== 'local-file')) {
    return data;
  }
  return {
    status: 'unresolved',
    reason: 'remote-local-path-denied',
    attempts: [
      ...data.attempts.filter(
        (attempt) =>
          attempt.route !== 'local-file' || !LOCAL_FILE_DISK_REASONS.has(attempt.reason),
      ),
      { route: 'local-file', reason: 'channel-denied-by-remote-shell' },
    ],
  };
}

/**
 * Local-Host user-gesture preview of a clicked path (ADR 0052 Slice 4).
 * Raster images are copied into the session media vault; text is returned
 * inline. Remote clients must not send this command.
 */
export type LocalFilePreviewCommandInput = {
  sessionId: string;
  /** Host-absolute path. Local sidecar only; never accepted from remote. */
  absolutePath: string;
};

export type LocalFilePreviewFailureReason =
  | 'not-found'
  | 'not-a-file'
  | 'binary'
  | 'too-large'
  | 'invalid-request';

export type LocalFilePreviewData =
  | {
      status: 'ready';
      kind: 'media';
      asset: SavedMediaAsset;
    }
  | {
      status: 'ready';
      kind: 'text';
      content: string;
      byteSize: number;
      truncated: boolean;
      readOnly: true;
    }
  | {
      status: 'unavailable';
      reason: LocalFilePreviewFailureReason;
      suggestion?: string;
    };

/**
 * Local-Host user-gesture export of a clicked path for Desktop Save As.
 * Returns whole-file bytes (base64). Remote clients must not send this.
 * Unlike preview/read-local-file, binary files are allowed up to the byte cap.
 */
export type LocalFileExportCommandInput = {
  /** Host-absolute path. Local sidecar only; never accepted from remote. */
  absolutePath: string;
  /** Soft cap in bytes; Host enforces a hard max. */
  maxBytes?: number;
};

export type LocalFileExportFailureReason =
  | 'not-found'
  | 'not-a-file'
  | 'too-large'
  | 'denied-location'
  | 'invalid-request';

export type LocalFileExportData =
  | {
      status: 'ready';
      fileName: string;
      mimeType: string;
      byteSize: number;
      base64Data: string;
    }
  | {
      status: 'unavailable';
      reason: LocalFileExportFailureReason;
      suggestion?: string;
    };

/**
 * Result of the local image-ingest command. Unlike LocalFilePreviewData, this
 * command is intentionally image-only and returns the saved asset directly.
 */
export type LocalMediaIngestFailureReason =
  | 'not-found'
  | 'not-a-file'
  | 'not-media'
  | 'too-large'
  | 'denied-location'
  | 'invalid-request';

export type LocalMediaIngestData =
  | {
      status: 'ready';
      asset: SavedMediaAsset;
    }
  | {
      status: 'unavailable';
      reason: LocalMediaIngestFailureReason;
      suggestion?: string;
    };
