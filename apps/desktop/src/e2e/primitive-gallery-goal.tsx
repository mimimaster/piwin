/**
 * Static Goal-mode fixtures for visual regression. Live Goal cards need a
 * `goal_*` tool payload the mock host cannot produce, so the gallery paints
 * the same class names the product uses (see `styles/goal.css`).
 */
import type { ReactElement, ReactNode } from 'react';

function GalleryStack(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section style={{ marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--muted)' }}>{props.title}</h3>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          width: '100%',
          maxWidth: '620px',
        }}
      >
        {props.children}
      </div>
    </section>
  );
}

export function GoalGalleryStates(): ReactElement {
  return (
    <>
      <GalleryStack title="Goal strip">
        <div
          className="goal-sticky-strip goal-status-running"
          data-testid="gallery-goal-strip-running"
          data-status="running"
        >
          <div className="goal-strip-main">
            <div className="goal-strip-badge">
              <span className="goal-status-dot dot-running" aria-hidden />
              <span className="goal-status-text">Goal running</span>
              <span className="goal-turn-pill">Turn 1</span>
            </div>
            <div className="goal-strip-title">ship the auth fix</div>
          </div>
        </div>
        <div
          className="goal-sticky-strip goal-status-waiting"
          data-testid="gallery-goal-strip-waiting"
          data-status="waiting"
        >
          <div className="goal-strip-main">
            <div className="goal-strip-badge">
              <span className="goal-status-dot dot-waiting" aria-hidden />
              <span className="goal-status-text">Goal waiting</span>
            </div>
            <div className="goal-strip-title">ship the auth fix</div>
          </div>
        </div>
        <div
          className="goal-sticky-strip goal-status-blocked"
          data-testid="gallery-goal-strip-blocked"
          data-status="blocked"
        >
          <div className="goal-strip-main">
            <div className="goal-strip-badge">
              <span className="goal-status-dot dot-blocked" aria-hidden />
              <span className="goal-status-text">Goal blocked</span>
            </div>
            <div className="goal-strip-title">ship the auth fix</div>
            <div className="goal-strip-blocker">pick a strategy</div>
          </div>
        </div>
        <div
          className="goal-sticky-strip goal-status-completed"
          data-testid="gallery-goal-strip-completed"
          data-status="completed"
        >
          <div className="goal-strip-main">
            <div className="goal-strip-badge">
              <span className="goal-status-dot dot-completed" aria-hidden />
              <span className="goal-status-text">Goal completed</span>
            </div>
            <div className="goal-strip-title">ship the auth fix</div>
          </div>
        </div>
      </GalleryStack>

      <GalleryStack title="Goal cards">
        <div className="goal-delivery-card" data-testid="gallery-goal-delivery-card">
          <div className="goal-delivery-header">
            <span className="goal-delivery-badge">
              <span className="goal-delivery-title">Goal accomplished</span>
            </span>
          </div>
          <div className="goal-delivery-body">
            <div className="goal-delivery-section">
              <p className="goal-section-label">Summary</p>
              <p className="goal-summary-text">Auth tests pass</p>
            </div>
            <div className="goal-delivery-section">
              <p className="goal-section-label">Verification</p>
              <pre className="goal-verification-pre">pnpm test -- auth (5/5)</pre>
            </div>
          </div>
        </div>

        <div className="goal-blocked-card" data-testid="gallery-goal-blocked-card">
          <div className="goal-blocked-header">
            <span className="goal-blocked-title">Goal is blocked</span>
          </div>
          <div className="goal-blocked-body">
            <div className="goal-blocked-section">
              <p className="goal-section-label">Reason</p>
              <p className="goal-reason-text">Two auth strategies are viable</p>
            </div>
            <div className="goal-blocked-section">
              <p className="goal-section-label">Needs from you</p>
              <p className="goal-action-text">Choose JWT or session cookies</p>
            </div>
          </div>
        </div>

        <div className="goal-wait-card is-running" data-testid="gallery-goal-wait-running" data-running="true">
          <span className="goal-wait-dot" aria-hidden />
          <span className="goal-wait-label">Waiting</span>
          <span className="goal-wait-reason">CI queue</span>
          <span className="goal-wait-duration">1m 30s</span>
        </div>

        <div className="goal-wait-card" data-testid="gallery-goal-wait-settled" data-running="false">
          <span className="goal-wait-dot" aria-hidden />
          <span className="goal-wait-label">Waited</span>
          <span className="goal-wait-reason">CI queue</span>
          <span className="goal-wait-duration">1m 30s</span>
        </div>
      </GalleryStack>
    </>
  );
}
