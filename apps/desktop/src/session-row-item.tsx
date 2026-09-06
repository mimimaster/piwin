import type { ReactElement } from 'react';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';
import type { DesktopCopy } from './desktop-locale';
import {
  IconArchive,
  IconCheck,
  IconDocument,
  IconFolder,
  IconMoreVertical,
  IconPin,
  IconTrash,
  IconUnarchive,
} from './shell-icons';
import { InkLineNode } from './ink-line-node';
import { formatSessionRelativeTime } from './session-relative-time';
import { sessionRowIsWorking, type SessionRowRunPhase } from './session-row-working';

/**
 * Right-side status slot. `waiting-you` and `background` keep their existing,
 * more elaborate treatments (rounded square via InkLineNode; three-dot wave)
 * since those already carry specific meaning; plain `running` renders through
 * the shared ink-line node so the sidebar dot and the tool-chain dot draw
 * from one vocabulary (Inkstone increment 7 §2 row 06).
 */
function SessionActivityIndicator(props: {
  isWorking: boolean;
  hasActiveBackendService: boolean;
  isWaitingOnPermission: boolean;
  workingLabel: string;
  backendServiceLabel: string;
  waitingOnYouLabel: string;
}): ReactElement | null {
  if (props.isWaitingOnPermission) {
    return (
      <span
        className="session-item-activity session-item-activity--waiting-you"
        data-testid="session-waiting-indicator"
      >
        <InkLineNode kind="waiting-you" label={props.waitingOnYouLabel} size="compact" />
      </span>
    );
  }

  if (props.hasActiveBackendService) {
    return (
      <span
        className="session-item-activity session-item-activity--service"
        data-testid="session-service-indicator"
        aria-label={props.backendServiceLabel}
        role="status"
      >
        <span className="session-item-activity-dot" aria-hidden />
        <span className="session-item-activity-dot" aria-hidden />
        <span className="session-item-activity-dot" aria-hidden />
      </span>
    );
  }

  if (props.isWorking) {
    return (
      <span
        className="session-item-activity session-item-activity--working"
        data-testid="session-working-indicator"
        aria-label={props.workingLabel}
        role="status"
      />
    );
  }

  return null;
}

export function SessionRowItem({
  session,
  activeSessionId,
  onResumeSession,
  onOpenSessionMenu,
  workingSessionIds,
  runPhase,
  backendServiceSessionIds,
  completedAttentionSessionIds,
  failedAttentionSessionIds,
  waitingPermissionSessionIds,
  onDismissCompletedAttention,
  onTogglePin,
  onArchiveSession,
  onUnarchiveSession,
  onDeleteSession,
  onResumeDraft,
  activeDraftId,
  isContextActive,
  copy,
  projectSubtitle,
}: {
  session: SessionListItemUi | DraftSessionItemUi;
  activeSessionId: string | null;
  onResumeSession: (sessionId: string) => void;
  onOpenSessionMenu: (sessionId: string, x: number, y: number) => void;
  onTogglePin?: ((sessionId: string, currentlyPinned: boolean) => void) | undefined;
  onArchiveSession?: ((sessionId: string) => void) | undefined;
  onUnarchiveSession?: ((sessionId: string) => void) | undefined;
  onDeleteSession?: ((sessionId: string) => void) | undefined;
  onResumeDraft?: ((draftId: string) => void) | undefined;
  activeDraftId?: string | null | undefined;
  isContextActive?: boolean | undefined;
  copy: DesktopCopy['sidebar'];
  projectSubtitle?: string | undefined;
  workingSessionIds?: Record<string, true> | undefined;
  runPhase?: SessionRowRunPhase | undefined;
  backendServiceSessionIds?: Record<string, true> | undefined;
  completedAttentionSessionIds?: Record<string, true> | undefined;
  failedAttentionSessionIds?: Record<string, true> | undefined;
  waitingPermissionSessionIds?: Record<string, true> | undefined;
  onDismissCompletedAttention?: ((sessionId: string) => void) | undefined;
}): ReactElement {
  const isDraft = 'isDraft' in session && session.isDraft === true;
  const isPinned = 'isPinned' in session && session.isPinned === true;
  const isArchived = 'isArchived' in session && session.isArchived === true;
  const storageState = !isDraft && 'storage' in session ? session.storage?.state : undefined;
  const isActive = isDraft ? session.id === activeDraftId : session.id === activeSessionId;
  const isWorking = sessionRowIsWorking({
    sessionId: session.id,
    isDraft,
    activeSessionId,
    runPhase: runPhase ?? 'idle',
    ...(workingSessionIds !== undefined ? { workingSessionIds } : {}),
  });
  const hasActiveBackendService =
    !isDraft && backendServiceSessionIds != null && session.id in backendServiceSessionIds;
  const isWaitingOnPermission =
    !isDraft && waitingPermissionSessionIds != null && session.id in waitingPermissionSessionIds;
  const hasActiveSessionWork = isWorking || hasActiveBackendService || isWaitingOnPermission;
  const hasCompletedAttention =
    !isDraft && completedAttentionSessionIds != null && session.id in completedAttentionSessionIds;
  const hasFailedAttention =
    !isDraft && failedAttentionSessionIds != null && session.id in failedAttentionSessionIds;

  return (
    <div
      key={session.id}
      className={[
        'session-row',
        ...(hasActiveSessionWork ? ['session-row--working'] : []),
        ...(hasCompletedAttention ? ['session-row--completed'] : []),
        ...(hasFailedAttention ? ['session-row--failed'] : []),
        ...(isDraft ? ['session-row--draft'] : []),
      ].join(' ')}
    >
      <button
        type="button"
        data-testid="session-item"
        data-session-id={session.id}
        data-pinned={isPinned ? 'true' : 'false'}
        data-archived={isArchived ? 'true' : 'false'}
        data-storage={storageState ?? 'local'}
        data-draft={isDraft ? 'true' : 'false'}
        data-completed={hasCompletedAttention ? 'true' : 'false'}
        data-failed={hasFailedAttention ? 'true' : 'false'}
        data-waiting-permission={isWaitingOnPermission ? 'true' : 'false'}
        data-context-active={isContextActive ? 'true' : 'false'}
        aria-current={isActive ? 'page' : undefined}
        aria-label={isDraft ? `${session.name} (draft)` : session.name}
        className={[
          isActive
            ? isWorking
              ? 'session-item active working'
              : 'session-item active'
            : isWorking
              ? 'session-item working'
              : isContextActive
                ? 'session-item context-active'
                : 'session-item',
          ...(projectSubtitle ? ['has-project-subtitle'] : []),
        ].join(' ')}
        onClick={() => (isDraft ? onResumeDraft?.(session.id) : onResumeSession(session.id))}
        onContextMenu={(event) => {
          if (isDraft) return;
          event.preventDefault();
          onOpenSessionMenu(session.id, event.clientX, event.clientY);
        }}
      >
        <span
          className={
            projectSubtitle
              ? 'session-item-body has-project-subtitle'
              : 'session-item-body'
          }
        >
          <span className="session-item-name">
            {isDraft ? <span className="session-draft-mark" aria-hidden /> : null}
            {isArchived ? (
              <span className="session-archived-mark" aria-hidden title={copy.archived}>
                <IconDocument width={13} height={13} />
              </span>
            ) : null}
            {storageState === 'offloaded' ? (
              <span
                className="session-storage-badge"
                data-testid="session-storage-badge"
                title={copy.offloaded}
              >
                {copy.offloaded}
              </span>
            ) : null}
            {storageState === 'missing-pack' ? (
              <span
                className="session-storage-badge session-storage-badge--missing"
                data-testid="session-storage-badge"
                title={copy.missingPack}
              >
                {copy.missingPack}
              </span>
            ) : null}
            {isPinned ? (
              <span className="session-pin-mark" aria-hidden>
                <IconPin width={12} height={12} />
              </span>
            ) : null}
            <span className="session-item-title-text">{session.name}</span>
          </span>
          {projectSubtitle ? (
            <span className="session-item-project-subtitle" data-testid="session-project-subtitle">
              <IconFolder width={12} height={12} className="session-item-project-icon" />
              <span className="session-item-project-name">{projectSubtitle}</span>
            </span>
          ) : null}
        </span>
        <SessionActivityIndicator
          isWorking={isWorking}
          hasActiveBackendService={hasActiveBackendService}
          isWaitingOnPermission={isWaitingOnPermission}
          workingLabel={copy.working}
          backendServiceLabel={copy.backendServiceActive}
          waitingOnYouLabel={copy.waitingOnYou}
        />
        {session.updatedAt &&
        !isWorking &&
        !hasActiveBackendService &&
        !isWaitingOnPermission &&
        !hasCompletedAttention &&
        !hasFailedAttention ? (
          <span className="session-item-time" aria-label={session.updatedAt}>
            {formatSessionRelativeTime(session.updatedAt)}
          </span>
        ) : null}
      </button>
      {hasCompletedAttention && !hasActiveSessionWork ? (
        <button
          type="button"
          className="session-item-completed-mark session-item-completed-dismiss"
          data-testid="session-completed-dismiss"
          aria-label={copy.dismissCompleted}
          title={copy.dismissCompleted}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDismissCompletedAttention?.(session.id);
          }}
        >
          <span data-testid="session-completed-indicator" aria-hidden>
            <IconCheck width={12} height={12} />
          </span>
        </button>
      ) : null}
      {hasFailedAttention && !hasActiveSessionWork ? (
        <button
          type="button"
          className="session-item-failed-mark session-item-failed-dismiss"
          data-testid="session-failed-dismiss"
          aria-label={copy.dismissFailed}
          title={copy.dismissFailed}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDismissCompletedAttention?.(session.id);
          }}
        >
          <InkLineNode kind="failed" label={copy.failedAttention} size="compact" />
        </button>
      ) : null}
      <div
        className={
          isDraft
            ? 'session-row-actions session-row-actions--draft'
            : isArchived
              ? 'session-row-actions session-row-actions--archived'
              : 'session-row-actions'
        }
      >
        {isArchived ? (
          <>
            <button
              type="button"
              className={
                isPinned
                  ? 'session-action-btn session-pin-btn active'
                  : 'session-action-btn session-pin-btn'
              }
              data-testid="session-pin-btn"
              title={isPinned ? copy.unpinSession : copy.pinSession}
              aria-label={isPinned ? copy.unpinSession : copy.pinSession}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin?.(session.id, isPinned);
              }}
            >
              <IconPin width={17} height={17} />
            </button>
            <button
              type="button"
              className="session-action-btn session-unarchive-btn"
              data-testid="session-unarchive-btn"
              title={copy.restoreSession}
              aria-label={copy.restoreSession}
              onClick={(event) => {
                event.stopPropagation();
                onUnarchiveSession?.(session.id);
              }}
            >
              <IconUnarchive width={17} height={17} />
            </button>
            <button
              type="button"
              className="session-action-btn session-delete-btn"
              data-testid="session-delete-btn"
              title={copy.deleteSessionPermanently}
              aria-label={copy.deleteSessionPermanently}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteSession?.(session.id);
              }}
            >
              <IconTrash width={17} height={17} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="session-action-btn session-menu-btn"
              data-testid="session-menu-btn"
              title={copy.sessionActions}
              aria-label={copy.sessionActions}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenSessionMenu(session.id, rect.right - 8, rect.bottom + 4);
              }}
            >
              <IconMoreVertical width={17} height={17} />
            </button>
            <button
              type="button"
              className={
                isPinned
                  ? 'session-action-btn session-pin-btn active'
                  : 'session-action-btn session-pin-btn'
              }
              data-testid="session-pin-btn"
              title={isPinned ? copy.unpinSession : copy.pinSession}
              aria-label={isPinned ? copy.unpinSession : copy.pinSession}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin?.(session.id, isPinned);
              }}
            >
              <IconPin width={17} height={17} />
            </button>
            <button
              type="button"
              className="session-action-btn session-archive-btn"
              data-testid="session-archive-btn"
              title={copy.archived}
              aria-label={copy.archived}
              onClick={(event) => {
                event.stopPropagation();
                onArchiveSession?.(session.id);
              }}
            >
              <IconArchive width={17} height={17} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
