/** E2E-only visual fixture for live and settled turn telemetry. */
import type { CSSProperties, ReactElement } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK, PIWIN_APPEARANCE_LIGHT } from '../appearance-tokens.js';
import { StatusBar } from '../status-bar.js';

export type TurnTelemetryFixtureProps = {
  onApplyTheme: (theme: ThemeManifest) => void;
};

const fixtureStyle: CSSProperties = {
  minHeight: '100vh',
  padding: '32px',
  background: 'var(--surface-2)',
  color: 'var(--text-1)',
};

const stageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 'min(920px, 100%)',
  margin: '36px auto',
};

function ComposerSample(props: { label: string }): ReactElement {
  return (
    <div className="composer-dock">
      <div className="composer-card-v2">
        <div className="composer-v2-input-area">
          <span className="composer-v2-textarea">{props.label}</span>
        </div>
        <div className="composer-v2-toolbar">
          <span className="composer-v2-toolbar-left">＋&nbsp;&nbsp;gpt-5.2-codex</span>
        </div>
      </div>
    </div>
  );
}

export function TurnTelemetryFixture(props: TurnTelemetryFixtureProps): ReactElement {
  return (
    <main style={fixtureStyle} data-testid="turn-telemetry-fixture">
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button onClick={() => props.onApplyTheme(PIWIN_APPEARANCE_DARK)}>Obsidian</Button>
        <Button onClick={() => props.onApplyTheme(PIWIN_APPEARANCE_LIGHT)}>Bone</Button>
      </div>

      <section className="chat-stage" style={stageStyle}>
        <ComposerSample label="Running telemetry" />
        <StatusBar locale="en" agentState="running" runStartedAt={Date.now() - 65_000} />
      </section>

      <section className="chat-stage" style={stageStyle}>
        <ComposerSample label="Settled telemetry" />
        <StatusBar
          locale="en"
          contextUsage={{
            sessionId: 'fixture-session',
            promptTokens: 12_480,
            completionTokens: 1_936,
            cacheReadTokens: 18_720,
            cacheWriteTokens: 0,
            durationMs: 18_420,
            source: 'assistant-usage',
            updatedAt: '2026-08-25T00:00:00.000Z',
          }}
        />
      </section>
    </main>
  );
}
