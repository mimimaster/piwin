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
import type { ComposerDraftAgentOption } from './composer-dock-types';
import { formatSessionRelativeTime } from './session-relative-time';

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

export function resolveEngineLabel(
  agentId: string,
  label: string,
  isChinese: boolean,
): string {
  if (agentId === 'pi') {
    return isChinese ? 'piwin 会话' : 'piwin session';
  }
  if (agentId === 'grok') {
    return isChinese ? 'grok 会话' : 'grok session';
  }
  const cleanLabel = (label || agentId).trim();
  if (isChinese) {
    return cleanLabel.endsWith('会话') ? cleanLabel : `${cleanLabel} 会话`;
  }
  return cleanLabel.toLowerCase().endsWith('session') ? cleanLabel : `${cleanLabel} session`;
}

export function EmptyStageLanding(props: EmptyStageLandingProps): ReactElement {
  const recentSessions = selectResumableSessions(props.sessions);
  const isChinese = props.locale === 'zh-CN';
  const heading = isChinese ? '研墨起笔' : 'Begin with Ink';
  const totalCount =
    props.sessions.filter((session) => !session.isArchived).length || props.sessions.length;
  const hasMultipleEngines = (props.draftAgentOptions?.length ?? 0) > 1;

  return (
    <div className="empty-stage-landing" data-testid="empty-stage-landing">
      <div className="welcome empty-stage-welcome">
        <span className="seal" data-testid="empty-stage-inkstone-seal" aria-hidden>
          砚
        </span>
        <h1>{heading}</h1>
        {hasMultipleEngines ? (
          <div
            className="empty-stage-engines"
            data-testid="empty-stage-engines"
            role="radiogroup"
            aria-label={isChinese ? '选择会话引擎' : 'Select Session Engine'}
          >
            {props.draftAgentOptions!.map((option) => {
              const isSelected = (props.draftAgentId ?? 'pi') === option.agentId;
              const engineLabel = resolveEngineLabel(option.agentId, option.label, isChinese);
              return (
                <button
                  key={option.agentId}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`empty-stage-engine-card${isSelected ? ' is-selected' : ''}${!option.ready ? ' is-not-ready' : ''}`}
                  data-testid={`empty-stage-engine-${option.agentId}`}
                  title={option.description || engineLabel}
                  onClick={() => props.onSelectDraftAgent?.(option.agentId)}
                >
                  <div className="empty-stage-engine-card-header">
                    <span className="empty-stage-engine-name">{engineLabel}</span>
                    <span
                      className={`empty-stage-engine-badge${option.agentId === 'pi' ? ' is-builtin' : option.ready ? ' is-ready' : ' is-warning'}`}
                    >
                      {option.agentId === 'pi'
                        ? isChinese
                          ? '内置'
                          : 'Built-in'
                        : option.ready
                          ? isChinese
                            ? '已就绪'
                            : 'Ready'
                          : option.state === 'unauthenticated'
                            ? isChinese
                              ? '未登录'
                              : 'Sign-in Required'
                            : option.state === 'unavailable'
                              ? isChinese
                                ? '未就绪'
                                : 'Not Ready'
                              : isChinese
                                ? '未安装 CLI'
                                : 'CLI Missing'}
                    </span>
                  </div>
                  {!option.ready && props.onOpenAgentSettings ? (
                    <div className="empty-stage-engine-footer">
                      <span
                        className="empty-stage-engine-settings-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onOpenAgentSettings?.();
                        }}
                      >
                        {isChinese ? '配置环境 →' : 'Configure →'}
                      </span>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
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
      ) : null}
    </div>
  );
}
