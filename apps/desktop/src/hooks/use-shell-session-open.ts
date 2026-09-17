import { useCallback } from 'react';
import type { ChatUiState } from '../chat-reducer';
import { shouldBindSessionToSecondaryPane } from '../conversation-pane-bind';
import {
  PRIMARY_CONVERSATION_PANE_ID,
  listConversationPaneLeaves,
} from '../conversation-pane-layout';
import { resolveEntityScope } from '../session-entities';
import { sessionScopeKey } from '../session-scope-key';
import type { ShellLayoutMode } from '../shell-layout';
import type { ConversationPaneLayoutController } from '../use-conversation-pane-layout';
import type { DockingWorkspaceController } from '../workbench/docking/use-docking-workspace';

export type ShellSessionOpen = (sessionId: string) => Promise<void>;

/** Non-frozen; matches the former workbench-app `onResumeSession` closure. */
export type ShellSessionOpenArgs = {
  setActiveSubPage: (page: null) => void;
  isOverlayPresentation: boolean;
  shell: { closeOverlay: () => void };
  state: ChatUiState;
  conversationPanesEnabled: boolean;
  dockingEnabled: boolean;
  layoutMode: ShellLayoutMode;
  dockingWorkspace: Pick<DockingWorkspaceController, 'openOrFocusSession'>;
  conversationPaneController: Pick<
    ConversationPaneLayoutController,
    'layout' | 'focus' | 'bindSession'
  >;
  handleResumeSession: (sessionId: string) => Promise<void>;
};

export function useShellSessionOpen(args: ShellSessionOpenArgs): ShellSessionOpen {
  const {
    setActiveSubPage,
    isOverlayPresentation,
    shell,
    state,
    conversationPanesEnabled,
    dockingEnabled,
    layoutMode,
    dockingWorkspace,
    conversationPaneController,
    handleResumeSession,
  } = args;

  return useCallback(
    (sessionId: string) => {
      setActiveSubPage(null);
      if (isOverlayPresentation) {
        shell.closeOverlay();
      }
      // Sidebar click switches the conversation. Docking rebinds the focused
      // pane (never appends a session tab).
      const clickedScope = resolveEntityScope(state, sessionId);
      if (
        conversationPanesEnabled &&
        dockingEnabled &&
        layoutMode !== 'phone' &&
        clickedScope !== null &&
        sessionScopeKey(clickedScope) === sessionScopeKey(state.activeScope)
      ) {
        dockingWorkspace.openOrFocusSession(sessionId);
      }
      if (conversationPanesEnabled) {
        const leaves = listConversationPaneLeaves(conversationPaneController.layout.root);
        if (leaves.length > 1) {
          const activePaneId = conversationPaneController.layout.activePaneId;
          const existingLeaf = leaves.find((leaf) => leaf.sessionId === sessionId);
          if (existingLeaf) {
            conversationPaneController.focus(existingLeaf.paneId);
            return Promise.resolve();
          }
          if (activePaneId !== PRIMARY_CONVERSATION_PANE_ID) {
            if (
              shouldBindSessionToSecondaryPane({
                sessionScope: resolveEntityScope(state, sessionId),
                activeScope: state.activeScope,
              })
            ) {
              conversationPaneController.bindSession(activePaneId, sessionId);
              return Promise.resolve();
            }
            conversationPaneController.focus(PRIMARY_CONVERSATION_PANE_ID);
          }
        }
      }
      return handleResumeSession(sessionId);
    },
    [
      conversationPaneController,
      conversationPanesEnabled,
      dockingEnabled,
      dockingWorkspace,
      handleResumeSession,
      isOverlayPresentation,
      layoutMode,
      setActiveSubPage,
      shell,
      state,
    ],
  );
}
