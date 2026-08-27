import type { ReactElement } from 'react';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';
import type { DesktopCopy } from './desktop-locale';
import {
  IconArchive,
  IconCheck,
  IconDocument,
  IconMoreVertical,
  IconPin,
  IconTrash,
  IconUnarchive,
} from './shell-icons';
import { formatSessionRelativeTime } from './session-relative-time';
import { sessionRowIsWorking, type SessionRowRunPhase } from './session-row-working';

function SessionActivityIndicator(props: {
  isWorking: boolean;
  hasActiveBackendService: boolean;
  workingLabel: string;
  backendServiceLabel: string;
}): ReactElement | null {
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
  onDismissCompletedAttention,
  onTogglePin,
  onArchiveSession,
  onUnarchiveSession,
  onDeleteSession,
  onResumeDraft,
  activeDraftId,
  isContextActive,
  copy,
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
  workingSessionIds?: Record<string, true> | undefined;
  runPhase?: SessionRowRunPhase | undefined;
  backendServiceSessionIds?: Record<string, true> | undefined;
  completedAttentionSessionIds?: Record<string, true> | undefined;
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
  const hasActiveSessionWork = isWorking || hasActiveBackendService;
  const hasCompletedAttention =
    !isDraft && completedAttentionSessionIds != null && session.id in completedAttentionSessionIds;

  return (
    <div
      key={session.id}
      className={[
        'session-row',
        ...(hasActiveSessionWork ? ['session-row--working'] : []),
        ...(hasCompletedAttention ? ['session-row--completed'] : []),
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
        data-context-active={isContextActive ? 'true' : 'false'}
        aria-current={isActive ? 'page' : undefined}
        className={
          isActive
            ? isWorking
              ? 'session-item active working'
              : 'session-item active'
            : isWorking
              ? 'session-item working'
              : isContextActive
                ? 'session-item context-active'
                : 'session-item'
        }
        onClick={() => (isDraft ? onResumeDraft?.(session.id) : onResumeSession(session.id))}
        onContextMenu={(event) => {
          if (isDraft) return;
          event.preventDefault();
          onOpenSessionMenu(session.id, event.clientX, event.clientY);
        }}
      >
        <span className="session-item-body">
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
        </span>
        <SessionActivityIndicator
          isWorking={isWorking}
          hasActiveBackendService={hasActiveBackendService}
          workingLabel={copy.working}
          backendServiceLabel={copy.backendServiceActive}
        />
        {session.updatedAt && !isWorking && !hasActiveBackendService && !hasCompletedAttention ? (
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
