/** Bounded Host-owned navigation index for user-authored transcript messages. */

export const SESSION_USER_MESSAGE_INDEX_DEFAULT_TICKS = 128;
export const SESSION_USER_MESSAGE_INDEX_MIN_TICKS = 16;
export const SESSION_USER_MESSAGE_INDEX_MAX_TICKS = 256;
export const SESSION_USER_MESSAGE_PREVIEW_CHARS = 120;
/** Hard serialized anchor budget returned to a client. */
export const SESSION_USER_MESSAGE_INDEX_MAX_BYTES = 128 * 1024;

export type SessionUserMessageIndexQuery = {
  sessionId: string;
  /** Maximum number of visible anchors requested by the client. */
  maximumTicks: number;
};

/**
 * Notable events inside a turn (a user message and everything up to the next
 * one), so a navigation rail can show where errors, artifacts, compactions
 * and branch points sit. Order here is display priority, highest first.
 */
export const SESSION_USER_MESSAGE_TURN_MARKS = ['error', 'compaction', 'branch', 'artifact'] as const;
export type SessionUserMessageTurnMark = (typeof SESSION_USER_MESSAGE_TURN_MARKS)[number];

export type SessionUserMessageAnchor = {
  /** Stable product message id used for seeking. */
  messageId: string;
  /** Zero-based ordinal among non-empty user messages. */
  ordinal: number;
  createdAt: string;
  preview: string;
  /** User-message ordinal span represented by this anchor. */
  spanStartOrdinal: number;
  /** Last user-message ordinal represented by this anchor, inclusive. */
  spanEndOrdinal: number;
  /**
   * Union of turn marks across the whole span, in
   * `SESSION_USER_MESSAGE_TURN_MARKS` order. Omitted when the span has none
   * (and on older Hosts).
   */
  marks?: SessionUserMessageTurnMark[];
};

export type SessionUserMessageIndexData = {
  sessionId: string;
  /** Changes only when indexed user content/order changes. */
  revision: string;
  totalUserMessages: number;
  mode: 'exact' | 'sampled';
  anchors: SessionUserMessageAnchor[];
  /** Serialized UTF-8 bytes of the anchors projection. */
  anchorBytes: number;
};
