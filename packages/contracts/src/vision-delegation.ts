/**
 * Vision delegation IPC types (text-only primary → describe images).
 */
import type { ModelRef } from './host.js';

export type VisionDelegateInput = {
  /** Absolute path under media root (preferred). */
  imagePath?: string;
  /** Alternative to path for one-shot tests (not stored). */
  imageBase64?: string;
  mimeType: string;
  /** Override system prompt for this call. */
  prompt?: string;
};

export type VisionDelegateResult = {
  description: string;
  model: ModelRef;
  durationMs: number;
  cacheHit: boolean;
};
