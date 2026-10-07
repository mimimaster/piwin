import type { LiveCallActivity, LiveCallPhase } from './voice-live.js';

/** Public system UI contains no provider bootstrap, transcript, or credentials. */
export type LiveSystemActivity = {
  callId: string;
  sessionId: string;
  sessionLabel: string;
  startedAt: string;
  phase: LiveCallPhase;
  activity: LiveCallActivity;
  muted: boolean;
};

export type LiveSystemControl = {
  callId: string;
  action: 'toggle-muted' | 'end' | 'open-session';
};

export function parseLiveSystemControl(value: unknown): LiveSystemControl | null {
  if (!value || typeof value !== 'object') return null;
  const { callId, action } = value as Record<string, unknown>;
  if (typeof callId !== 'string' || !callId.trim() || callId.length > 256) return null;
  if (action !== 'toggle-muted' && action !== 'end' && action !== 'open-session') return null;
  return { callId, action };
}
