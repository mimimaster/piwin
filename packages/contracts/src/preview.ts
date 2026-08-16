/**
 * Trusted-domain read-only text preview (ADR 0052 Slice 3).
 *
 * Addressed by a config-root-relative path only — never a host-absolute
 * path — so remote clients can preview `~/.piwin/**` text without learning
 * or forging Host filesystem layout. Media vault bytes stay on `media/read`.
 */

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
