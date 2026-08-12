/** Bounded Host-owned navigation index for user-authored transcript messages. */

export const SESSION_USER_MESSAGE_INDEX_DEFAULT_TICKS = 128;
export const SESSION_USER_MESSAGE_INDEX_MIN_TICKS = 16;
export const SESSION_USER_MESSAGE_INDEX_MAX_TICKS = 256;
export const SESSION_USER_MESSAGE_PREVIEW_CHARS = 120;
export const SESSION_USER_MESSAGE_INDEX_MAX_BYTES = 128 * 1024;

export type SessionUserMessageIndexQuery = {
  sessionId: string;
  /** Maximum number of visible anchors requested by the client. */
  maximumTicks: number;
};

export type SessionUserMessageAnchor = {
  /** Stable product message id used for seeking. */
  messageId: string;
  /** Zero-based ordinal among non-empty user messages. */
  ordinal: number;
  createdAt: string;
  preview: string;
  /** User-message ordinal span represented by this anchor. */
  spanStartOrdinal: number;
  spanEndOrdinal: number;
};

export type SessionUserMessageIndexData = {
  sessionId: string;
  /** Changes only when indexed user content/order changes. */
  revision: string;
  totalUserMessages: number;
  mode: 'exact' | 'sampled';
  anchors: SessionUserMessageAnchor[];
  anchorBytes: number;
};
