import type { LiveCallView, LiveSystemActivity, LiveSystemControl } from '@piwin/contracts';
import type { LivePeerSnapshot } from './live-peer.js';

export function projectLiveSystemActivity(call: LiveCallView | null, peer: LivePeerSnapshot): LiveSystemActivity | null {
  if (!call || peer.phase === 'idle' || peer.phase === 'ended' || peer.phase === 'error' ||
    call.phase === 'ended' || call.phase === 'failed') return null;
  return {
    callId: call.callId,
    sessionId: call.boundSessionId,
    sessionLabel: call.boundSessionLabel.slice(0, 80),
    startedAt: call.startedAt,
    phase: call.phase === 'active' && peer.phase !== 'connected' ? 'starting' : call.phase,
    activity: peer.muted ? 'muted' : call.activity ?? 'listening',
    muted: peer.muted || call.activity === 'muted',
  };
}

export async function applyLiveSystemControl(input: {
  control: LiveSystemControl;
  call: LiveCallView | null;
  muted: boolean;
  setMuted: (muted: boolean) => Promise<void>;
  end: () => Promise<void>;
  openSession: (sessionId: string) => void | Promise<unknown>;
}): Promise<void> {
  if (!input.call || input.control.callId !== input.call.callId) return;
  if (input.control.action === 'end') await input.end();
  else if (input.control.action === 'toggle-muted') await input.setMuted(!input.muted);
  else await input.openSession(input.call.boundSessionId);
}
