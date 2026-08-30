import type { HostCommand, HostResponse, MediaReadVariant, MediaThumbEdge } from '@piwin/contracts';

export type MediaLibraryHost = {
  request: (command: HostCommand) => Promise<HostResponse>;
};

function objectUrlFromBase64(mimeType: string, base64Data: string): string {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/**
 * Fetch vault bytes for the studio. Caller owns the object URL and must revoke it.
 * Does not share the transcript preview cache — gallery thumbs must not pin originals.
 */
export async function readLibraryMediaViaHost(
  host: MediaLibraryHost,
  input: { sessionId: string; assetId: string; variant: MediaReadVariant; thumbEdge?: MediaThumbEdge },
): Promise<string | null> {
  const response = await host.request({
    type: 'media/read',
    input: {
      sessionId: input.sessionId,
      assetId: input.assetId,
      variant: input.variant,
      ...(input.thumbEdge !== undefined ? { thumbEdge: input.thumbEdge } : {}),
    },
  });
  if (!response.success || response.data === undefined) {
    return null;
  }
  const data = response.data as {
    status?: string;
    mimeType?: string;
    base64Data?: string;
  };
  if (data.status !== 'ready' || !data.base64Data || !data.mimeType) {
    return null;
  }
  return objectUrlFromBase64(data.mimeType, data.base64Data);
}
