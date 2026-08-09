import type { ModelRef } from './host.js';

/** Maximum transient audio payload accepted by the Desktop ASR command. */
export const SPEECH_MAX_AUDIO_BYTES = 15 * 1024 * 1024;

/** Maximum recording duration accepted by the Desktop ASR command. */
export const SPEECH_MAX_DURATION_MS = 2 * 60 * 1000;

/** Audio payload crossing Desktop → Host. The Host must not persist it. */
export type SpeechTranscribeInput = {
  mimeType: string;
  base64Data: string;
  durationMs?: number;
};

/** Safe response from Host ASR; it intentionally contains no audio payload. */
export type SpeechTranscribeData = {
  text: string;
  model: ModelRef;
  durationMs: number;
};
