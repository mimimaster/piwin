/**
 * Session/composer gestures that App used to inline: document open, new
 * session, drafts, extension UI, and artifact canvas width.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { ArtifactCanvasTarget } from '../artifact-canvas-model';
import type { DraftSessionItemUi } from '../draft-session';
import type { HostClient } from '../host-client';
import type { DocumentOpenInput } from '../tool-call-card';
import type { RightPanelTab } from '../right-panel';
import type { ExtensionUiRequestState } from './use-host-bootstrap';
import { tryOpenHtmlDocumentInBrowser } from '../open-html-in-browser.js';
import { isOverlayShellLayout, type ShellLayoutMode } from '../shell-layout';

const ARTIFACT_CANVAS_MIN_PANEL_WIDTH_PX = 560;

export type UseWorkbenchSessionGesturesArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  inspectorFileDiff: {
    clear: () => void;
    open: (absolutePath: string, relativePath?: string) => void;
  };
  openDocumentBase: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  revealDocPreview: () => void;
  artifactCanvas: { openTarget: (target: ArtifactCanvasTarget) => void };
  layoutMode: ShellLayoutMode;
  rightPanelWidthPx: number;
  setRightPanelWidthPx: (widthPx: number) => void;
  openInspector: (tab?: RightPanelTab | null) => void;
  startNewDraft: (scope?: { kind: 'general' } | { kind: 'project'; projectPath: string }) => void;
  handleNewSession: (options?: {
    scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
  }) => Promise<void>;
  draftSessions: DraftSessionItemUi[];
  handleOpenProject: (path: string) => Promise<void>;
  hydrateSessions: (
    scope?: { kind: 'general' } | { kind: 'project'; projectPath: string },
    options?: { includeArchived?: boolean },
  ) => Promise<unknown>;
  resumeDraft: (draftId: string) => void;
  showArchivedSessions: boolean;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  extensionUiRequest: ExtensionUiRequestState | null;
  clearExtensionUiRequest: (requestId: string) => void;
  handleAbort: () => Promise<void>;
};

export function useWorkbenchSessionGestures(args: UseWorkbenchSessionGesturesArgs) {
  const {
    hostClient,
    state,
    dispatch,
    inspectorFileDiff,
    openDocumentBase,
    revealDocPreview,
    artifactCanvas,
    layoutMode,
    rightPanelWidthPx,
    setRightPanelWidthPx,
    openInspector,
    startNewDraft,
    handleNewSession,
    draftSessions,
    handleOpenProject,
    hydrateSessions,
    resumeDraft,
    showArchivedSessions,
    setEditingMessageId,
    extensionUiRequest,
    clearExtensionUiRequest,
    handleAbort,
  } = args;

  const handleOpenDocument = useCallback(
    (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => {
      inspectorFileDiff.clear();
      if (
        tryOpenHtmlDocumentInBrowser({
          doc,
          projectPath: state.projectPath,
          canNavigate: hostClient.supportsCommand('browser/navigate'),
          openInspector,
          navigate: (url) => {
            void hostClient.browserNavigate(url);
          },
        })
      ) {
        return;
      }
      openDocumentBase(doc, target);
    },
    [hostClient, inspectorFileDiff, openDocumentBase, openInspector, state.projectPath],
  );
  const handleOpenDiff = useCallback(
    (absolutePath: string, relativePath?: string) => {
      if (!state.projectPath || !hostClient.supportsCommand('git/diff-file')) {
        handleOpenDocument(
          {
            title: (relativePath || absolutePath).split(/[\\/]/).pop() || absolutePath,
            path: absolutePath,
          },
          'inspector',
        );
        return;
      }
      inspectorFileDiff.open(absolutePath, relativePath);
      revealDocPreview();
    },
    [handleOpenDocument, hostClient, inspectorFileDiff, revealDocPreview, state.projectPath],
  );
  const handleOpenArtifactCanvas = useCallback(
    (target: ArtifactCanvasTarget): void => {
      artifactCanvas.openTarget(target);
      if (!isOverlayShellLayout(layoutMode) && rightPanelWidthPx < ARTIFACT_CANVAS_MIN_PANEL_WIDTH_PX) {
        setRightPanelWidthPx(ARTIFACT_CANVAS_MIN_PANEL_WIDTH_PX);
      }
      openInspector('canvas');
    },
    [artifactCanvas.openTarget, layoutMode, openInspector, rightPanelWidthPx, setRightPanelWidthPx],
  );
  const handleStartNewSession = useCallback(
    async (options?: {
      scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
    }): Promise<void> => {
      const scope = options?.scope;
      // Mirror Conversations +: switch scope first, then enter the draft.
      // Project-row + only passes scope; opening belongs here so it cannot
      // race bumpToDraft and cancel project/set.
      if (scope?.kind === 'project') {
        const alreadyThere =
          state.activeScope.kind === 'project' &&
          state.activeScope.projectPath === scope.projectPath;
        if (!alreadyThere) {
          await handleOpenProject(scope.projectPath);
        }
      }
      startNewDraft(scope);
      await handleNewSession(options);
    },
    [handleNewSession, handleOpenProject, startNewDraft, state.activeScope],
  );
  const handleResumeDraft = useCallback(
    async (draftId: string): Promise<void> => {
      const draft = draftSessions.find((item) => item.id === draftId);
      if (!draft) return;
      const isSameScope =
        state.activeScope.kind === draft.scope.kind &&
        (draft.scope.kind === 'general' ||
          (state.activeScope.kind === 'project' &&
            state.activeScope.projectPath === draft.scope.projectPath));
      if (!isSameScope) {
        if (draft.scope.kind === 'general') {
          dispatch({ type: 'project/clear' });
          await hydrateSessions(
            { kind: 'general' },
            { includeArchived: showArchivedSessions },
          );
        } else {
          await handleOpenProject(draft.scope.projectPath);
        }
      }
      resumeDraft(draftId);
    },
    [
      dispatch,
      draftSessions,
      handleOpenProject,
      hydrateSessions,
      resumeDraft,
      showArchivedSessions,
      state.activeScope,
    ],
  );
  const handleRetryMessage = useCallback((messageId: string): void => {
    setEditingMessageId(messageId);
  }, [setEditingMessageId]);
  const handleCommentLine = useCallback((_lineContent: string) => {
    setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus();
    }, 50);
  }, []);
  const handleExtensionUiResolve = useCallback(
    async (payload: {
      confirmed?: boolean;
      value?: string;
      cancelled?: boolean;
    }): Promise<void> => {
      const active = extensionUiRequest;
      if (!active) {
        return;
      }
      const response = await hostClient.request({
        type: 'extension/ui_resolve',
        requestId: active.requestId,
        ...(payload.confirmed !== undefined ? { confirmed: payload.confirmed } : {}),
        ...(payload.value !== undefined ? { value: payload.value } : {}),
        ...(payload.cancelled !== undefined ? { cancelled: payload.cancelled } : {}),
      });
      clearExtensionUiRequest(active.requestId);
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
      }
    },
    [clearExtensionUiRequest, dispatch, extensionUiRequest, hostClient],
  );
  const handleExtensionUiAbort = useCallback(async (): Promise<void> => {
    const active = extensionUiRequest;
    if (active) {
      clearExtensionUiRequest(active.requestId);
    }
    await handleAbort();
  }, [clearExtensionUiRequest, extensionUiRequest, handleAbort]);

  return {
    handleOpenDocument,
    handleOpenDiff,
    handleOpenArtifactCanvas,
    handleStartNewSession,
    handleResumeDraft,
    handleRetryMessage,
    handleCommentLine,
    handleExtensionUiResolve,
    handleExtensionUiAbort,
  };
}
