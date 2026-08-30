/**
 * R1 WP1.2 — Tauri WebRTC spike panel.
 * Visible only when VITE_PIWIN_LIVE_SPIKE=1 and hash #/live-spike.
 * Does not touch Session, Agent, OAuth, or Settings.
 */
import { useLiveSpikePeer } from './use-live-spike-peer.js';

const CONTROL_MIN_PX = 44;

export function LiveSpikePanel() {
  const {
    snapshot,
    startLoopback,
    startRemote,
    setMuted,
    bargeIn,
    resumeRemote,
    stop,
  } = useLiveSpikePeer();

  const busy =
    snapshot.phase === 'acquiring-mic' || snapshot.phase === 'negotiating';

  return (
    <main
      className="live-spike-panel"
      data-testid="live-spike-panel"
      style={{
        minHeight: '100vh',
        padding: 24,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        background: 'var(--piwin-bg, #0f1115)',
        color: 'var(--piwin-fg, #e8eaed)',
        boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>piwin Live — WebRTC spike</h1>
      <p style={{ margin: '0 0 20px', opacity: 0.75, maxWidth: 52 * 8 }}>
        Dev-only. Start Host-shaped negotiate with{' '}
        <code>
          PIWIN_LIVE_SPIKE_CODEX_TOKEN=… pnpm exec tsx scripts/piwin-live-spike/host-call.ts --serve
          8787
        </code>{' '}
        for remote mode (Codex backend, not Platform API). Loopback proves mic + cleanup without a
        token.
      </p>

      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', marginBottom: 24 }}>
        <dt>phase</dt>
        <dd data-testid="live-spike-phase">{snapshot.phase}</dd>
        <dt>muted</dt>
        <dd>{String(snapshot.muted)}</dd>
        <dt>remotePlaying</dt>
        <dd>{String(snapshot.remotePlaying)}</dd>
        <dt>cleanupCount</dt>
        <dd data-testid="live-spike-cleanup-count">{snapshot.cleanupCount}</dd>
        <dt>error</dt>
        <dd data-testid="live-spike-error">{snapshot.errorCode ?? '—'}</dd>
      </dl>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <SpikeButton disabled={busy} onClick={() => void startLoopback()} testId="live-spike-loopback">
          Start loopback
        </SpikeButton>
        <SpikeButton disabled={busy} onClick={() => void startRemote()} testId="live-spike-remote">
          Start remote (Host spike)
        </SpikeButton>
        <SpikeButton
          disabled={snapshot.phase !== 'connected'}
          onClick={() => setMuted(!snapshot.muted)}
          testId="live-spike-mute"
        >
          {snapshot.muted ? 'Unmute' : 'Mute'}
        </SpikeButton>
        <SpikeButton
          disabled={snapshot.phase !== 'connected'}
          onClick={() => bargeIn()}
          testId="live-spike-barge-in"
        >
          Barge-in
        </SpikeButton>
        <SpikeButton
          disabled={snapshot.phase !== 'connected'}
          onClick={() => resumeRemote()}
          testId="live-spike-resume"
        >
          Resume remote
        </SpikeButton>
        <SpikeButton
          disabled={snapshot.phase === 'idle' || snapshot.phase === 'ended'}
          onClick={() => void stop()}
          testId="live-spike-stop"
        >
          End / cleanup
        </SpikeButton>
      </div>

      <p style={{ marginTop: 28, fontSize: 13, opacity: 0.6 }} aria-live="polite">
        Controls are ≥{CONTROL_MIN_PX}px. Keyboard: Tab to focus, Enter/Space to activate.
      </p>
    </main>
  );
}

function SpikeButton(props: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        minHeight: CONTROL_MIN_PX,
        minWidth: CONTROL_MIN_PX,
        padding: '0 16px',
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, currentColor 28%, transparent)',
        background: 'color-mix(in srgb, currentColor 8%, transparent)',
        color: 'inherit',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.45 : 1,
        fontSize: 14,
      }}
    >
      {props.children}
    </button>
  );
}
