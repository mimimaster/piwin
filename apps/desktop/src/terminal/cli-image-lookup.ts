/**
 * Resolve a file an agent TUI generated to the Host media asset Desktop can
 * show. The image only becomes a transcript attachment once the Host replays
 * the agent's history, so the lookup syncs first.
 */
import {
  formatError,
  type HostCommand,
  type HostResponse,
  type MediaAttachmentRef,
  type SessionTranscriptMessage,
} from '@piwin/contracts';

export type CliImageLookup =
  | { status: 'found'; attachment: MediaAttachmentRef }
  | { status: 'missing' }
  | { status: 'failed'; error: string };

type CliImageHost = { request: (command: HostCommand) => Promise<HostResponse> };

/** Newest first: a regenerated file reuses its name, and the user clicked the latest. */
export function findGeneratedImage(
  messages: readonly SessionTranscriptMessage[],
  fileName: string,
): MediaAttachmentRef | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const attachments = messages[index]?.attachments ?? [];
    for (let position = attachments.length - 1; position >= 0; position -= 1) {
      const attachment = attachments[position];
      if (attachment?.kind === 'media' && attachment.name === fileName) return attachment;
    }
  }
  return undefined;
}

export async function lookupCliImage(
  host: CliImageHost,
  sessionId: string,
  fileName: string,
): Promise<CliImageLookup> {
  try {
    const synced = await host.request({ type: 'agents/cli-snapshot', sessionId });
    if (!synced.success) return { status: 'failed', error: synced.error };
    const listed = await host.request({ type: 'session/messages', sessionId });
    if (!listed.success) return { status: 'failed', error: listed.error };
    const messages = (listed.data as { messages?: SessionTranscriptMessage[] }).messages ?? [];
    const attachment = findGeneratedImage(messages, fileName);
    return attachment === undefined ? { status: 'missing' } : { status: 'found', attachment };
  } catch (error) {
    return { status: 'failed', error: formatError(error) };
  }
}
