/**
 * Empty-stage landing point.
 *
 * A brand-new session used to render an unbroken void above the composer, so
 * the eye had nowhere to settle and resuming recent work meant reaching for
 * the sidebar. This adds the one thing the stage can offer without becoming a
 * landing page: a micro-label and the handful of sessions the user is most
 * likely to continue. The composer stays the subject (Deck §1) — this sits
 * above it, quiet, and disappears the moment a turn exists.
 */
import type { ReactElement } from 'react';
import type { SessionListItemUi } from './chat-ui-types';
import type { DesktopLocale } from './desktop-locale';
import { formatSessionRelativeTime } from './session-relative-time';

/** Enough to be useful, few enough that the composer keeps the visual weight. */
const MAX_RECENT_SESSIONS = 4;

export type EmptyStageLandingProps = {
  locale: DesktopLocale;
  sessions: readonly SessionListItemUi[];
  onResumeSession: (sessionId: string) => void;
};

function resolveSessionTitle(session: SessionListItemUi, locale: DesktopLocale): string {
  const name = session.name.trim();
  if (name) {
    return name;
  }
  return locale === 'zh-CN' ? '未命名会话' : 'Untitled session';
}

/**
 * Newest first, and only sessions that carry a turn: an empty draft offers
 * nothing to resume and would read as a duplicate of the current stage.
 * Archived sessions are excluded — the user filed them away deliberately.
 */
export function selectResumableSessions(
  sessions: readonly SessionListItemUi[],
  limit = MAX_RECENT_SESSIONS,
): SessionListItemUi[] {
  return sessions
    .filter((session) => (session.messageCount ?? 0) > 0 && session.isArchived !== true)
    .slice()
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
    .slice(0, limit);
}

export function EmptyStageLanding(props: EmptyStageLandingProps): ReactElement | null {
  const recentSessions = selectResumableSessions(props.sessions);
  if (recentSessions.length === 0) {
    return null;
  }

  return (
    <div className="empty-stage-landing" data-testid="empty-stage-landing">
      <p className="empty-stage-landing-label">
        {props.locale === 'zh-CN' ? '继续上次' : 'Pick up where you left off'}
      </p>
      <ul className="empty-stage-landing-list">
        {recentSessions.map((session) => {
          const relativeTime = formatSessionRelativeTime(session.updatedAt);
          return (
            <li key={session.id}>
              <button
                type="button"
                className="empty-stage-landing-row"
                data-testid="empty-stage-landing-row"
                onClick={() => props.onResumeSession(session.id)}
              >
                <span className="empty-stage-landing-title">
                  {resolveSessionTitle(session, props.locale)}
                </span>
                {relativeTime ? (
                  <span className="empty-stage-landing-time">{relativeTime}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}