/**
 * Empty-stage landing point.
 *
 * Sits above the centered composer on a session with no turns. Inkstone
 * shows a seal + serif heading; every theme can list recent sessions on
 * the composer measure so titles line up with the slab's left edge.
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

function parseSessionTimestamp(dateString?: string): number {
  if (!dateString) {
    return 0;
  }
  const timestamp = Date.parse(dateString);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

/**
 * Filter for sessions worth resuming:
 * - Excludes archived sessions
 * - Includes sessions with turns, preview content, or user-assigned names
 * - Drops untouched untitled drafts
 * - Orders newest first by update timestamp, tie-breaking by name
 */
export function selectResumableSessions(
  sessions: readonly SessionListItemUi[],
  limit = MAX_RECENT_SESSIONS,
): SessionListItemUi[] {
  return sessions
    .filter((session) => {
      if (session.isArchived === true) {
        return false;
      }
      if ((session.messageCount ?? 0) > 0) {
        return true;
      }
      if (session.lastPreview && session.lastPreview.trim().length > 0) {
        return true;
      }
      const trimmedName = session.name?.trim();
      return Boolean(
        trimmedName &&
          trimmedName !== '未命名会话' &&
          trimmedName !== 'Untitled session' &&
          !trimmedName.startsWith('draft-'),
      );
    })
    .slice()
    .sort((left, right) => {
      const leftTime = parseSessionTimestamp(left.updatedAt);
      const rightTime = parseSessionTimestamp(right.updatedAt);
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

export function EmptyStageLanding(props: EmptyStageLandingProps): ReactElement {
  const recentSessions = selectResumableSessions(props.sessions);
  const isChinese = props.locale === 'zh-CN';
  const heading =
    recentSessions.length > 0
      ? isChinese
        ? '继续上次'
        : 'Pick up where you left off'
      : isChinese
        ? '开始新对话'
        : 'Start a new chat';

  return (
    <div className="empty-stage-landing" data-testid="empty-stage-landing">
      <div className="welcome empty-stage-welcome">
        <span className="seal" data-testid="empty-stage-inkstone-seal" aria-hidden>
          砚
        </span>
        <h1>{heading}</h1>
        {recentSessions.length === 0 ? (
          <p>{isChinese ? '问任何问题。' : 'Ask anything.'}</p>
        ) : null}
      </div>
      {recentSessions.length > 0 ? (
        <ul className="empty-stage-landing-list">
          {recentSessions.map((session) => {
            const relativeTime = formatSessionRelativeTime(session.updatedAt);
            const title = resolveSessionTitle(session, props.locale);
            return (
              <li key={session.id}>
                <button
                  type="button"
                  className="empty-stage-landing-row"
                  data-testid="empty-stage-landing-row"
                  onClick={() => props.onResumeSession(session.id)}
                  title={title}
                >
                  <span className="empty-stage-landing-title">{title}</span>
                  {relativeTime ? (
                    <span className="empty-stage-landing-time">{relativeTime}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
