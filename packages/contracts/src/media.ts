export type SavedMediaAsset = {
  id: string;
  sessionId: string;
  absolutePath: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  createdAt: string;
};

export type SaveMediaInput = {
  sessionId: string;
  bytes: Uint8Array;
  mimeType: string;
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

export function formatTextModelImageInjection(
  attachment: TextModelImageInjection
): string {
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
