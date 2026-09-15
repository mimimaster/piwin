/**
 * Static Goal-mode fixtures for visual regression. Live Goal cards need a
 * `goal_*` tool payload the mock host cannot produce, so the gallery paints
 * the same class names the product uses (see `styles/goal.css`); the lid
 * renders the real component from static views.
 */
import type { ReactElement, ReactNode } from 'react';
import type { ChatMessageUi } from '../chat-ui-types';
import { GoalStickyStrip } from '../goal/GoalStickyStrip';
import type { GoalSessionView } from '../goal/goal-session-model';

const GALLERY_OBJECTIVE: ChatMessageUi = {
  id: 'gallery-goal-objective',
  role: 'user',
  text: 'ship the auth fix',
  thinking: '',
  tools: [],
  attachments: [],
  status: 'done',
  agentMode: 'goal',
};

function galleryView(
  phase: GoalSessionView['phase'],
  latest: GoalSessionView['latest'] = null,
): GoalSessionView {
  return {
    phase,
    objective: 'ship the auth fix',
    roundCount: 1,
    latest,
    latestToolCallId: null,
    objectiveIndex: 0,
  };
}

const GALLERY_LID_VIEWS: readonly GoalSessionView[] = [
  galleryView('running'),
  galleryView('waiting'),
  galleryView('blocked', { phase: 'blocked', reason: 'pick a strategy' }),
  galleryView('completed', { phase: 'completed', summary: 'Auth tests pass' }),
];

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
      <GalleryStack title="Goal lid">
        {GALLERY_LID_VIEWS.map((view) => (
          <div key={view.phase} data-testid={`gallery-goal-strip-${view.phase}`}>
            <GoalStickyStrip
              view={view}
              messages={[GALLERY_OBJECTIVE]}
              onAbort={() => undefined}
              onExit={() => undefined}
            />
          </div>
        ))}
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
