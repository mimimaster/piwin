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
