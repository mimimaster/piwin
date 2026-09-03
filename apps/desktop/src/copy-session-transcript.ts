/**
 * Copy a session's product transcript to the clipboard.
 * Reuses Host `session/export` with destination=content so remote Hosts
 * do not need a client-readable filesystem path.
 */
import type { HostResponse } from '@piwin/contracts';

export type CopySessionTranscriptClient = {
  request: (command: {
    type: 'session/export';
    sessionId: string;
    format: 'md';
    destination: 'content';
  }) => Promise<HostResponse>;
};

export type CopySessionTranscriptResult = { ok: true } | { ok: false; message: string };

export async function copySessionTranscript(input: {
  hostClient: CopySessionTranscriptClient;
  sessionId: string;
  writeText?: (text: string) => Promise<void>;
}): Promise<CopySessionTranscriptResult> {
  const response = await input.hostClient.request({
    type: 'session/export',
    sessionId: input.sessionId,
    format: 'md',
    destination: 'content',
  });
  if (!response.success) {
    return { ok: false, message: response.error };
  }
  const content =
    response.data && typeof response.data === 'object' && 'content' in response.data
      ? (response.data as { content?: unknown }).content
      : undefined;
  if (typeof content !== 'string') {
    return { ok: false, message: 'Host did not return transcript content.' };
  }
  try {
    const writeText = input.writeText ?? ((text: string) => navigator.clipboard.writeText(text));
    await writeText(content);
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not copy transcript' };
  }
}
