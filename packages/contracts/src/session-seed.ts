/** Initial product-history messages for an ephemeral agent session. */

import type { SessionCompactionSeed } from './compaction.js';

/**
 * Opaque serialized Pi-native message copy (spec: session-conversation-tree §4.1).
 * Only `@piwin/agent-host` may encode or decode `payload`; product packages and
 * clients must treat it as an opaque string.
 */
export type NativeContextEntry = {
  format: 'pi-message-v1';
  /** JSON of one Pi `Message`. Empty when `truncated` is set. */
  payload: string;
  byteLength: number;
  /** Payload exceeded the per-entry cap and was dropped; replay falls back to text. */
  truncated?: boolean;
};

export type SessionSeedMessage = {
  role: 'user' | 'assistant';
  text: string;
  /** Unix timestamp in milliseconds, matching Pi message timestamps. */
  timestamp: number;
  /** When present the backend replays these native messages instead of `text`. */
  native?: NativeContextEntry[];
};

export type CreateSessionOptions = {
  /**
   * History to load into a temporary agent session before it is returned.
   * The history is not persisted by the host or by Pi.
   */
  seedMessages?: readonly SessionSeedMessage[];
  /**
   * `compaction` (default) keeps the aggressive keep-recent compaction override
   * used by compact snapshots and subagent continuations. `replay` seeds
   * full-fidelity history and must not force compaction.
   */
  seedMode?: 'compaction' | 'replay';
  /**
   * Durable native compaction summary to prepend to a reconstructed runtime.
   * The summary is kept out of the visible product transcript.
   */
  compactionSeed?: SessionCompactionSeed;
};
