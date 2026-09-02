import type { HostCommand, HostResponse, MediaReadVariant, MediaThumbEdge } from '@piwin/contracts';
import { readMediaObjectUrlViaHost } from '../../media-host-read';

export type MediaLibraryHost = {
  request: (command: HostCommand) => Promise<HostResponse>;
};

/**
 * Fetch vault bytes for the studio. Caller owns the object URL and must revoke it.
 * Does not share the transcript preview cache — gallery thumbs must not pin originals.
 * Videos over the wire cap are assembled from ranged `media/read` slices.
 */
export async function readLibraryMediaViaHost(
  host: MediaLibraryHost,
  input: { sessionId: string; assetId: string; variant: MediaReadVariant; thumbEdge?: MediaThumbEdge },
): Promise<string | null> {
  return readMediaObjectUrlViaHost(
    {
      request: (command) => host.request(command),
    },
    input,
  );
}
