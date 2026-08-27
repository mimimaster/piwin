import type { ModelRef, ThinkingLevel } from './host.js';

type BackendPreparedPromptFields = {
  text: string;
  images?: Array<{ dataBase64: string; mimeType: string }>;
  streamingBehavior?: 'steer' | 'followUp';
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};

/** Frozen prompt projection consumed by a foreground agent backend. */
export type BackendPreparedPrompt = BackendPreparedPromptFields & {
  /** Host-owned execution identity for worker frames and Host tools. */
  runId: string;
};

/**
 * Prompt projection for a caller that is not bound to a product Run
 * (background/ephemeral). Foreground session turns must use
 * {@link BackendPreparedPrompt}.
 */
export type UnownedBackendPreparedPrompt = BackendPreparedPromptFields & {
  runId?: string;
};
