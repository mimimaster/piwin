import type {
  HostCommand,
  HostResponse,
  SessionTranscriptPageData,
  SessionTranscriptPageQuery,
} from '@piwin/contracts';

type TranscriptPageCommand = Extract<HostCommand, { type: 'session/transcript-page' }>;
type TranscriptPage = Extract<SessionTranscriptPageData, { status: 'page' }>;

export type SessionTranscriptPageRequester = (
  command: TranscriptPageCommand,
) => Promise<HostResponse>;

export type SessionTranscriptPageRequestResult =
  | { success: true; data: TranscriptPage; restartedAtTail: boolean }
  | { success: false; error: string };

/** Fetch one older page and perform at most one cursorless stale recovery. */
export async function requestSessionTranscriptPage(
  request: SessionTranscriptPageRequester,
  query: SessionTranscriptPageQuery,
): Promise<SessionTranscriptPageRequestResult> {
  let response = await request({ type: 'session/transcript-page', query });
  // Older Hosts threw on a cursor/page-limit mismatch. New Hosts normalize it
  // to stale-cursor, but Desktop keeps this narrow bridge so mixed-version and
  // HMR sessions can recover without showing a global action failure.
  const recoverLegacyLimitMismatch =
    !response.success &&
    query.beforeCursor !== undefined &&
    response.error.includes('transcript cursor limits do not match');
  let data: SessionTranscriptPageData;
  if (!response.success) {
    if (!recoverLegacyLimitMismatch) {
      return { success: false, error: response.error };
    }
    data = { status: 'stale-cursor', currentRevision: 'legacy-limit-mismatch' };
  } else {
    data = response.data as SessionTranscriptPageData;
  }
  let restartedAtTail = false;
  if (data.status === 'stale-cursor') {
    const restartQuery: SessionTranscriptPageQuery = { ...query };
    delete restartQuery.beforeCursor;
    response = await request({ type: 'session/transcript-page', query: restartQuery });
    if (!response.success) return { success: false, error: response.error };
    data = response.data as SessionTranscriptPageData;
    restartedAtTail = true;
  }
  if (data.status !== 'page') {
    return { success: false, error: 'Transcript page remained stale after one tail restart' };
  }
  return { success: true, data, restartedAtTail };
}
