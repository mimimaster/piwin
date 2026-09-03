/**
 * Bound-session continuity for the Live spoken surface.
 * Summary text is owner/provider material only — never LiveCallView.
 */

import type { SessionTranscriptMessage } from './session-transcript.js';

export const LIVE_STARTUP_CONTEXT_MAX_CHARS = 1_200;
export const LIVE_STARTUP_CONTEXT_INPUT_MAX_BYTES = 24 * 1024;
export const LIVE_TYPED_INPUT_MAX_CHARS = 500;

export const PIWIN_LIVE_STARTUP_CONTEXT_HEADER = [
  'Startup context from the bound work session before this call started.',
  'It may be summarized. Use it to answer questions about the earlier conversation.',
  'Do not recite it unless relevant. The chat page remains the source of truth.',
].join(' ');

export function renderLiveStartupContext(summary: string): string {
  return `${PIWIN_LIVE_STARTUP_CONTEXT_HEADER}\n<startup_context>\n${summary.trim()}\n</startup_context>`;
}

/**
 * Commentary when the user types into the bound session during a call.
 * Deliberately promises nothing about admission: the typed turn may still be
 * queued, replaced, or cancelled on the chat page.
 */
export function piwinLiveTypedInputContext(text: string): string {
  const clipped = clipLiveContextText(text, LIVE_TYPED_INPUT_MAX_CHARS);
  return [
    'The user typed this into the bound work session, so you did not hand it over.',
    'Update your context and do not delegate it.',
    'Do not claim you started, queued, or finished it, and do not narrate its progress.',
    `<typed_input>\n${clipped}\n</typed_input>`,
  ].join(' ');
}

export function clipLiveContextText(raw: string, maxChars: number): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars).trimEnd()}…`;
}

export type LiveContextTranscriptTurn = {
  role: 'user' | 'assistant';
  label: 'User' | 'Assistant' | 'Voice handover';
  text: string;
};

/**
 * Single definition of which transcript rows any Live layer may read, so the
 * startup summary, the cache key, and the intent-review excerpt cannot drift.
 */
export function toLiveContextTranscriptTurn(
  message: SessionTranscriptMessage,
): LiveContextTranscriptTurn | null {
  if (message.status !== 'done') return null;
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const text = message.text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (message.role === 'assistant') return { role: 'assistant', label: 'Assistant', text };
  return {
    role: 'user',
    label: message.source === 'voice-delegation' ? 'Voice handover' : 'User',
    text,
  };
}