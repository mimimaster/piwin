import type { ReactElement } from 'react';
import type { HoldToTalkPhase } from '../../hold-to-talk.js';

export type HoldToTalkOverlayProps = {
  phase: HoldToTalkPhase;
  liveTranscript: string;
  cancelling: boolean;
  hint?: string | undefined;
};

export function HoldToTalkOverlay({
  phase,
  liveTranscript,
  cancelling,
  hint,
}: HoldToTalkOverlayProps): ReactElement | null {
  if (phase === 'idle' && hint === undefined) {
    return null;
  }
  const title =
    phase === 'finalizing'
      ? '正在识别…'
      : cancelling
        ? '松开取消'
        : phase === 'listening'
          ? '松开发送 · 上滑取消'
          : hint;
  return (
    <div className="hold-to-talk-overlay" data-testid="mobile-hold-overlay" data-phase={phase}>
      <strong className="hold-to-talk-title">{title}</strong>
      {liveTranscript.length > 0 ? (
        <p className="hold-to-talk-transcript">{liveTranscript}</p>
      ) : null}
    </div>
  );
}
