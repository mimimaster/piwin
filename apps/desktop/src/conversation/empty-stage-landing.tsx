/**
 * Empty-stage landing point.
 *
 * Sits above the centered composer on a session with no turns. Inkstone
 * shows a seal + serif heading; every theme can list recent sessions on
 * the composer measure so titles line up with the slab's left edge.
 */
import type { ReactElement } from 'react';
import type { SessionListItemUi } from './chat-ui-types';
import type { DesktopLocale } from '../i18n/desktop-locale';
import type { ComposerDraftAgentOption } from '../composer/composer-dock-types';
import { EmptyStageSessionChoices } from './empty-stage-session-choices.js';
import { formatSessionRelativeTime } from '../session/session-relative-time';

/** Enough to be useful, few enough that the composer keeps the visual weight. */
const MAX_RECENT_SESSIONS = 4;

export type EmptyStageLandingProps = {
  locale: DesktopLocale;
  sessions: readonly SessionListItemUi[];
  onResumeSession: (sessionId: string) => void;
  onOpenAllSessions?: (() => void) | undefined;
  runningSessionIds?: Record<string, boolean | true> | undefined;
  draftAgentId?: string | undefined;
  draftAgentOptions?: readonly ComposerDraftAgentOption[] | undefined;
  onSelectDraftAgent?: ((agentId: string) => void) | undefined;
  onOpenAgentSettings?: (() => void) | undefined;
  /** The scope's list has not answered yet: hold its space so nothing jumps. */
  sessionsLoading?: boolean | undefined;
};

/** Widths of the placeholder titles, one per recent row. */
const PLACEHOLDER_TITLE_WIDTHS = [62, 48, 74, 55] as const;

function RecentSessionsPlaceholder(props: { isChinese: boolean }): ReactElement {
  return (
    <div
      className="empty-stage-landing-history is-loading"
      data-testid="empty-stage-landing-loading"
      role="status"
      aria-label={props.isChinese ? '正在载入最近会话' : 'Loading recent sessions'}
    >
      <div className="empty-stage-landing-header" aria-hidden="true">
        <span className="empty-stage-landing-label">{props.isChinese ? '最近' : 'Recent'}</span>
        <span className="empty-stage-landing-divider" />
      </div>
      <ul className="empty-stage-landing-list" aria-hidden="true">
        {PLACEHOLDER_TITLE_WIDTHS.map((width) => (
          <li key={width}>
            <span className="empty-stage-landing-row">
              <span className="empty-stage-landing-placeholder" style={{ width: `${width}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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

export { resolveEngineLabel } from './empty-stage-session-choices.js';

export function EmptyStageLanding(props: EmptyStageLandingProps): ReactElement {
  const recentSessions = selectResumableSessions(props.sessions);
  const isChinese = props.locale === 'zh-CN';
  const heading = isChinese ? '研墨起笔' : 'Begin with Ink';
  const totalCount =
    props.sessions.filter((session) => !session.isArchived).length || props.sessions.length;

  return (
    <div className="empty-stage-landing" data-testid="empty-stage-landing">
      <div className="welcome empty-stage-welcome">
        <span className="seal" data-testid="empty-stage-inkstone-seal" aria-hidden>
          砚
        </span>
        <h1>{heading}</h1>
        <EmptyStageSessionChoices
          locale={props.locale}
          draftAgentId={props.draftAgentId}
          draftAgentOptions={props.draftAgentOptions}
          onSelectDraftAgent={props.onSelectDraftAgent}
          onOpenAgentSettings={props.onOpenAgentSettings}
        />
      </div>
      {recentSessions.length > 0 ? (
        <div className="empty-stage-landing-history" data-testid="empty-stage-landing-history">
          <div className="empty-stage-landing-header">
            <span className="empty-stage-landing-label">{isChinese ? '最近' : 'Recent'}</span>
            <span className="empty-stage-landing-divider" aria-hidden="true" />
            {props.onOpenAllSessions ? (
              <button
                type="button"
                className="empty-stage-landing-all-link"
                data-testid="empty-stage-landing-all"
                onClick={props.onOpenAllSessions}
              >
                {isChinese ? `全部 ${totalCount} →` : `All ${totalCount} →`}
              </button>
            ) : (
              <span className="empty-stage-landing-all-link" data-testid="empty-stage-landing-all">
                {isChinese ? `全部 ${totalCount} →` : `All ${totalCount} →`}
              </span>
            )}
          </div>
          <ul className="empty-stage-landing-list">
            {recentSessions.map((session) => {
              const relativeTime = formatSessionRelativeTime(session.updatedAt);
              const title = resolveSessionTitle(session, props.locale);
              const isRunning = Boolean(props.runningSessionIds?.[session.id]);
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    className="empty-stage-landing-row"
                    data-testid="empty-stage-landing-row"
                    onClick={() => props.onResumeSession(session.id)}
                    title={title}
                  >
                    <span
                      className={`empty-stage-landing-dot${isRunning ? ' is-running' : ''}`}
                      aria-hidden="true"
                    />
                    <span className="empty-stage-landing-title">{title}</span>
                    {relativeTime ? (
                      <span className="empty-stage-landing-time">{relativeTime}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : props.sessionsLoading === true ? (
        <RecentSessionsPlaceholder isChinese={isChinese} />
      ) : null}
    </div>
  );
}
