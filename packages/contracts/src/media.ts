import type { AttachmentContentKind } from './attachment.js';

export type SavedMediaAsset = {
  id: string;
  sessionId: string;
  absolutePath: string;
  mimeType: string;
  name?: string;
  contentKind?: AttachmentContentKind;
  byteSize: number;
  width?: number;
  height?: number;
  createdAt: string;
};

export type SaveMediaInput = {
  sessionId: string;
  bytes: Uint8Array;
  mimeType: string;
  name?: string;
  contentKind?: AttachmentContentKind;
  source: 'paste' | 'drop' | 'file-picker' | 'generated';
};

/** Text injected into text-only model prompts. */
export type TextModelImageInjection = {
  absolutePath: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
};

/**
 * Stable failure reasons for media/read (ADR 0052). Remote-safe: the payload
 * never carries host-absolute paths in either variant.
 */
export type MediaReadFailureReason =
  | 'not-found'
  | 'outside-media-root'
  | 'too-large'
  | 'invalid-request';

export type MediaReadData =
  | {
      status: 'ready';
      assetId: string;
      sessionId: string;
      mimeType: string;
      byteSize: number;
      /** Bytes are base64 only while crossing the client-to-host transport. */
      base64Data: string;
    }
  | {
      status: 'unavailable';
      reason: MediaReadFailureReason;
      suggestion?: string;
    };

export function formatTextModelImageInjection(attachment: TextModelImageInjection): string {
  const dimensionPart =
    attachment.width && attachment.height
      ? `\ndimensions: ${attachment.width}x${attachment.height}`
      : '';
  return [
    '[attached image]',
    `path: ${attachment.absolutePath}`,
    `mime: ${attachment.mimeType}`,
    `size: ${attachment.byteSize} bytes${dimensionPart}`,
  ].join('\n');
}
