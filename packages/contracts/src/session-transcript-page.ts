import type { SessionTranscriptMessage } from './session-transcript.js';

/** Initial / page size for session transcript windows (was 16 — too small for coding sessions). */
export const SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS = 50;
export const SESSION_TRANSCRIPT_PAGE_MAX_ITEMS = 50;
export const SESSION_TRANSCRIPT_PAGE_MIN_BYTES = 16 * 1024;
export const SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES = 256 * 1024;
export const SESSION_TRANSCRIPT_PAGE_MAX_BYTES = 512 * 1024;

/** Optional response projection for transcript-mutating compatibility commands. */
export type SessionMessageProjection = 'full' | 'tail' | 'none';

/** Host-owned query for a tail or older transcript page. */
export type SessionTranscriptPageQuery = {
  sessionId: string;
  limit: number;
  /** Maximum serialized UTF-8 bytes retained by the `messages` projection. */
  maximumBytes: number;
  /** Opaque exclusive upper boundary returned as `olderCursor`. */
  beforeCursor?: string;
};

export type SessionTranscriptPageInfo = {
  /** Opaque revision of the complete durable transcript projection. */
  revision: string;
  totalCount: number;
  /** Inclusive source transcript index represented by the first message. */
  startIndex: number;
  /** Exclusive source transcript index represented by this page. */
  endIndex: number;
  /** Serialized UTF-8 bytes retained by the page's message array. */
  messageBytes: number;
  /** Messages whose UI projection was clipped to honor the byte boundary. */
  truncatedMessageIds?: string[];
  /** Fetches the next older page when present. */
  olderCursor?: string;
};

/**
 * A stale cursor is a normal concurrent-transcript outcome. Clients replace
 * their local window with a new cursorless tail page before continuing.
 */
export type SessionTranscriptPageResult<Message> =
  | {
      status: 'page';
      messages: Message[];
      page: SessionTranscriptPageInfo;
    }
  | {
      status: 'stale-cursor';
      currentRevision: string;
    };

export type SessionTranscriptPageData = SessionTranscriptPageResult<SessionTranscriptMessage>;
