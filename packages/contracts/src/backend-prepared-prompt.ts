import type { ModelRef, ThinkingLevel } from './host.js';

/** Frozen prompt projection consumed by an agent backend. */
export type BackendPreparedPrompt = {
  text: string;
  /** Host-owned execution identity for worker frames and Host tools. */
  runId?: string;
  images?: Array<{ dataBase64: string; mimeType: string }>;
  streamingBehavior?: 'steer' | 'followUp';
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};
