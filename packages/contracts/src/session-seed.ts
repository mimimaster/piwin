/** Initial product-history messages for an ephemeral agent session. */

export type SessionSeedMessage = {
  role: 'user' | 'assistant';
  text: string;
  /** Unix timestamp in milliseconds, matching Pi message timestamps. */
  timestamp: number;
};

export type CreateSessionOptions = {
  /**
   * History to load into a temporary agent session before it is returned.
   * The history is not persisted by the host or by Pi.
   */
  seedMessages?: readonly SessionSeedMessage[];
};
