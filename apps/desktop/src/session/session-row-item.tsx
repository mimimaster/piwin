import type { ReactElement } from 'react';
import type { SessionListItemUi } from '../conversation/chat-reducer';
import type { DraftSessionItemUi } from '../composer/draft-session';
import type { DesktopCopy } from '../i18n/desktop-locale';
import {
  IconArchive,
  IconDocument,
  IconFolder,
  IconGit,
  IconMoreVertical,
  IconBookmark,
  IconTrash,
  IconUnarchive,
} from '../tool-cards/shell-icons';
import { resolveSessionNodeStatus } from './session-node-status';
import { SessionStatusMark } from './session-status-mark';
import { formatSessionRelativeTime } from './session-relative-time';
import {
  sessionRowHasLiveActivity,
  sessionRowIsWorking,
  type SessionRowRunPhase,
} from './session-row-working';
import { sessionScopeKey } from './session-scope-key';
import { agentDisplayName } from '../agents/agent-backend-state';
import { ProviderIcon } from '@piwin/ui-kit';
import { useSessionRowDragGesture } from '../workbench/docking/use-session-row-drag-gesture.js';

/** proto-03 `.i.s12` inside `.ib.s22` hit targets. */
const SESSION_ACTION_ICON_PX = 12;

/**
 * The preview is one ellipsized line (plus a `title` tooltip). A draft's text
 * can be a whole pasted transcript; feeding it all to the row re-laid-out that
 * text in the sidebar on every keystroke. Sanitize a bounded head (wrappers it
 * strips sit at the start) and cap what reaches the DOM.
 */
const PREVIEW_SOURCE_MAX_CHARS = 2000;
const PREVIEW_MAX_CHARS = 300;

/**
 * Cleans up raw preview strings (e.g. stripping prompt metadata, XML context refs,
 * transcript history preambles, and message headers) before showing in session cards.
 */
export function sanitizePreviewSnippet(raw: string): string {
  if (!raw) return '';
  let text = raw.trim();

  // If there is "--- Current user message:", prioritize whatever comes after it
  const currentMsgMatch = text.match(/(?:---|___)\s*Current user message:\s*([\s\S]*)$/i);
  if (currentMsgMatch && currentMsgMatch[1]) {
    text = currentMsgMatch[1].trim();
  }

  // Strip XML-style context refs: <context_ref ...> ... </context_ref>
  text = text.replace(/<context_ref[^>]*>[\s\S]*?<\/context_ref>/gi, '').trim();
  text = text.replace(/<[^>]+>/g, '').trim();

  // Strip piwin wrappers and history markers
  text = text.replace(/\[\/?piwin-product-history\]/gi, '').trim();
  text = text.replace(/\[\/?piwin[^\]]*\]/gi, '').trim();
  text = text.replace(/Prior conversation \([^)]*\):?/gi, '').trim();
  text = text.replace(/^[^[\]\n]*?not Pi JSONL\)?:\s*/gi, '').trim();

  // If there is a "User: ... \nAssistant:", take the User's input
  const userToAssistantMatch = text.match(/(?:^|\n)\s*User:\s*([\s\S]*?)(?=(?:\n\s*Assistant:|$))/i);
  if (userToAssistantMatch && userToAssistantMatch[1]?.trim()) {
    text = userToAssistantMatch[1].trim();
  } else {
    text = text.replace(/^(?:User|Assistant):\s*/gi, '').trim();
  }

  // Strip system prompt / orchestrator boilerplates if leaked without user message
  if (
    text.startsWith('Operating contract for this turn') ||
    text.startsWith('Orchestration scheme') ||
    text.startsWith('A detailed walkthrough will be auto-generated')
  ) {
    return '';
  }

  text = text.replace(/\[\/?piwin[^\]]*\]/gi, '').trim();
  text = text.replace(/\s+/g, ' ').trim();
  return text;
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
  worktree,
  onTogglePin,
  onArchiveSession,
  onUnarchiveSession,
  onDeleteSession,
  onResumeDraft,
  activeDraftId,
  isContextActive,
  copy,
  projectSubtitle,
  isPinnedSection,
  hideActionCluster = false,
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
  isPinnedSection?: boolean | undefined;
  workingSessionIds?: Record<string, true> | undefined;
  runPhase?: SessionRowRunPhase | undefined;
  backendServiceSessionIds?: Record<string, true> | undefined;
  completedAttentionSessionIds?: Record<string, true> | undefined;
  failedAttentionSessionIds?: Record<string, true> | undefined;
  waitingPermissionSessionIds?: Record<string, true> | undefined;
  /** Set when the session runs in a linked worktree rather than the repository's own checkout. */
  worktree?: { name: string; branch: string | null } | undefined;
  /** Touch rows reveal the same actions by swiping (swipeable-session-row.tsx). */
  hideActionCluster?: boolean | undefined;
}): ReactElement {
  const isDraft = 'isDraft' in session && session.isDraft === true;
  const isPinned = 'isPinned' in session && session.isPinned === true;
  const isArchived = 'isArchived' in session && session.isArchived === true;
  const storageState = !isDraft && 'storage' in session ? session.storage?.state : undefined;
  // ADR 0082: only a non-Pi binding earns a badge; a Pi session stays unlabelled
  // because Pi is the product default.
  const backendAgentId =
    !isDraft && 'backend' in session ? session.backend?.agentId : undefined;
  const backendBadge = backendAgentId !== undefined ? agentDisplayName(backendAgentId) : null;
  // Agents with a brand mark show it instead of the text pill; Grok reuses the
  // shared xAI provider logo.
  const backendLogoId = backendAgentId === 'grok' ? 'xai' : null;
  const isActive = isDraft ? session.id === activeDraftId : session.id === activeSessionId;
  const sessionScope = 'scope' in session ? session.scope : undefined;
  const dragScopeKey = sessionScope ? sessionScopeKey(sessionScope) : undefined;
  const dragGesture = useSessionRowDragGesture({
    enabled: !isDraft,
    sessionId: session.id,
    label: session.name,
    ...(dragScopeKey ? { projectScopeKey: dragScopeKey } : {}),
  });
  const nativeOwner = 'nativeCli' in session ? session.nativeCli : undefined;
  const nativeActivity = nativeOwner?.kind === 'native' ? nativeOwner.activity : undefined;
  const isWorking = sessionRowIsWorking({
    sessionId: session.id,
    isDraft,
    activeSessionId,
    runPhase: runPhase ?? 'idle',
    nativeActivity,
    ...(workingSessionIds !== undefined ? { workingSessionIds } : {}),
  });
  const hasActiveBackendService =
    !isDraft && backendServiceSessionIds != null && session.id in backendServiceSessionIds;
  const isWaitingOnPermission =
    nativeActivity === 'waiting' || !isDraft && waitingPermissionSessionIds != null && session.id in waitingPermissionSessionIds;
  const hasActiveSessionWork = sessionRowHasLiveActivity({
    sessionId: session.id,
    isDraft,
    activeSessionId,
    runPhase: runPhase ?? 'idle',
    nativeActivity,
    ...(workingSessionIds !== undefined ? { workingSessionIds } : {}),
    ...(backendServiceSessionIds !== undefined
      ? { backendServiceSessionIds }
      : {}),
    ...(waitingPermissionSessionIds !== undefined
      ? { waitingPermissionSessionIds }
      : {}),
  });
  const hasCompletedAttention =
    !isDraft && completedAttentionSessionIds != null && session.id in completedAttentionSessionIds;
  const hasFailedAttention =
    !isDraft && failedAttentionSessionIds != null && session.id in failedAttentionSessionIds;
  const nodeStatus = isDraft
    ? null
    : resolveSessionNodeStatus({
        isWorking,
        hasActiveBackendService,
        isWaitingOnPermission,
        hasFailedAttention,
        hasCompletedAttention,
      });

  const rawPreview = isDraft
    ? session.text.trimStart().slice(0, PREVIEW_SOURCE_MAX_CHARS)
    : 'lastPreview' in session && typeof session.lastPreview === 'string'
      ? session.lastPreview.trim()
      : '';
  const cleanedPreview = sanitizePreviewSnippet(rawPreview).slice(0, PREVIEW_MAX_CHARS);
  const unquoted = cleanedPreview.replace(/^[“"']+|[”"']+$/g, '').trim();
  const formattedPreview = unquoted ? `“${unquoted}”` : null;

  const logoBadge =
    backendBadge !== null && backendLogoId !== null ? (
      <span
        className="session-backend-badge session-backend-badge--logo"
        data-testid="session-backend-badge"
        data-backend-logo={backendLogoId}
        role="img"
        aria-label={backendBadge}
        title={backendBadge}
      >
        <ProviderIcon id={backendLogoId} name={backendBadge} variant="glyph" size={12} />
      </span>
    ) : null;
  // piwin only knows the checkout of sessions it runs itself. An external
  // agent reports a working directory, not a worktree, so it never gets this
  // mark and always keeps its own.
  const worktreeLabel =
    worktree !== undefined && backendBadge === null
      ? copy.sessionInWorktree(worktree.name, worktree.branch)
      : null;
  // One slot, one mark, read down the column: a live or unread status when the
  // session has one, otherwise what kind of session this is.
  const leadMark = nodeStatus !== null ? (
    <SessionStatusMark
      kind={nodeStatus}
      labels={{
        working: copy.working,
        backendServiceActive: copy.backendServiceActive,
        waitingOnYou: copy.waitingOnYou,
        completed: copy.completed,
        failedAttention: copy.failedAttention,
      }}
    />
  ) : isDraft ? (
    <span className="session-draft-mark" aria-hidden />
  ) : logoBadge !== null ? (
    logoBadge
  ) : worktreeLabel !== null ? (
    <span
      className="session-worktree-mark"
      data-testid="session-worktree-mark"
      role="img"
      aria-label={worktreeLabel}
      title={worktreeLabel}
    >
      <IconGit width={13} height={13} />
    </span>
  ) : backendBadge === null ? (
    <span className="session-native-mark" data-testid="session-native-mark" aria-hidden />
  ) : null;

  return (
    <div
      key={session.id}
      className={[
        'session-row',
        ...(isActive ? ['session-row--active'] : []),
        ...(hasActiveSessionWork ? ['session-row--working'] : []),
        ...(hasCompletedAttention ? ['session-row--completed'] : []),
        ...(hasFailedAttention ? ['session-row--failed'] : []),
        ...(isDraft ? ['session-row--draft'] : []),
        ...(formattedPreview ? ['session-row--has-preview'] : []),
      ].join(' ')}
    >
      <button
        type="button"
        data-testid="session-item"
        data-session-id={session.id}
        data-pinned={isPinned ? 'true' : 'false'}
        data-pinned-section={isPinnedSection ? 'true' : 'false'}
        data-archived={isArchived ? 'true' : 'false'}
        data-storage={storageState ?? 'local'}
        data-draft={isDraft ? 'true' : 'false'}
        data-completed={hasCompletedAttention ? 'true' : 'false'}
        data-failed={hasFailedAttention ? 'true' : 'false'}
        data-waiting-permission={isWaitingOnPermission ? 'true' : 'false'}
        data-context-active={isContextActive ? 'true' : 'false'}
        aria-current={isActive ? 'page' : undefined}
        aria-label={isDraft ? `${session.name} (draft)` : session.name}
        data-tauri-drag-region="false"
        onClickCapture={dragGesture.onClickCapture}
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
          ...(isPinnedSection ? ['session-item--pinned'] : []),
          ...(projectSubtitle && !isPinnedSection ? ['has-project-subtitle'] : []),
          ...(formattedPreview ? ['has-preview'] : []),
        ].join(' ')}
        onClick={() => (isDraft ? onResumeDraft?.(session.id) : onResumeSession(session.id))}
        onContextMenu={(event) => {
          if (isDraft) return;
          event.preventDefault();
          onOpenSessionMenu(session.id, event.clientX, event.clientY);
        }}
      >
        {isPinnedSection ? (
          <span className="session-item-pinned-ribbon" data-testid="session-pinned-ribbon" aria-hidden>
            <svg viewBox="0 0 9 14" width="9" height="14" fill="currentColor">
              <path d="M0 0h9v14l-4.5-3.5-4.5 3.5z" />
            </svg>
          </span>
        ) : null}
        <span
          className={
            projectSubtitle && !isPinnedSection
              ? 'session-item-body has-project-subtitle'
              : formattedPreview
                ? 'session-item-body has-preview'
                : 'session-item-body'
          }
        >
          <span className="session-item-name" {...dragGesture.handleProps}>
            <span className="session-lead" data-status={nodeStatus ?? undefined}>
              {leadMark}
            </span>
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
            {backendBadge !== null && backendLogoId === null ? (
              <span
                className="session-backend-badge"
                data-testid="session-backend-badge"
                title={backendBadge}
              >
                {backendBadge}
              </span>
            ) : null}
            {isPinned && !isPinnedSection ? (
              <span className="session-pin-mark" aria-hidden>
                <IconBookmark width={12} height={12} />
              </span>
            ) : null}
            <span className="session-item-title-text">{session.name}</span>
          </span>
          {projectSubtitle && !isPinnedSection ? (
            <span className="session-item-project-subtitle" data-testid="session-project-subtitle">
              <IconFolder width={12} height={12} className="session-item-project-icon" />
              <span className="session-item-project-name">{projectSubtitle}</span>
            </span>
          ) : formattedPreview ? (
            <span
              className="session-item-preview"
              data-testid="session-item-preview"
              title={cleanedPreview}
            >
              {formattedPreview}
            </span>
          ) : null}
        </span>
        {session.updatedAt ? (
          <span className="session-item-time" aria-label={session.updatedAt}>
            {formatSessionRelativeTime(session.updatedAt)}
          </span>
        ) : null}
      </button>
      {hideActionCluster ? null : (
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
                <IconBookmark width={SESSION_ACTION_ICON_PX} height={SESSION_ACTION_ICON_PX} />
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
                <IconUnarchive width={SESSION_ACTION_ICON_PX} height={SESSION_ACTION_ICON_PX} />
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
                <IconTrash width={SESSION_ACTION_ICON_PX} height={SESSION_ACTION_ICON_PX} />
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
                <IconMoreVertical width={SESSION_ACTION_ICON_PX} height={SESSION_ACTION_ICON_PX} />
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
                <IconBookmark width={SESSION_ACTION_ICON_PX} height={SESSION_ACTION_ICON_PX} />
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
                <IconArchive width={SESSION_ACTION_ICON_PX} height={SESSION_ACTION_ICON_PX} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
