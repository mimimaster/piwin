import type { ChatUiAction, ChatUiState } from './chat-ui-types.js';
import { stashOwnedTranscript } from '../session/session-warm-cache.js';
import { CLEARED_SUBAGENT_UI } from './chat-reducer-session-helpers.js';

type ChatUiProjectAction = Extract<
  ChatUiAction,
  {
    type:
      'scope/set' | 'project/set' | 'project/clear' | 'project/trust-dialog' | 'project/trusted';
  }
>;

/** Project activation settles Host trust separately from cached session scope. */
export function reduceChatProject(state: ChatUiState, action: ChatUiProjectAction): ChatUiState {
  switch (action.type) {
    case 'scope/set':
      if (action.scope.kind === 'general' && state.activeScope.kind === 'general') {
        return state;
      }
      if (
        action.scope.kind === 'project' &&
        state.activeScope.kind === 'project' &&
        action.scope.projectPath === state.activeScope.projectPath
      ) {
        return state;
      }
      return {
        ...state,
        activeScope: action.scope,
        warmSessionCache: stashOwnedTranscript(state.warmSessionCache, state),
        // Switching scope clears the visible session list; hydrate reloads it.
        sessions: [],
        // Keep the live session identity so composer snapshots see A→B, not
        // a fake New Agent gap. Transcript paint is cleared below.
        transcriptOwnerSessionId: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        compacting: false,
        compactionActivity: null,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    case 'project/set': {
      const warmSessionCache = action.keepActiveSession
        ? state.warmSessionCache
        : stashOwnedTranscript(state.warmSessionCache, state);
      if (action.keepActiveSession === true) {
        return {
          ...state,
          activeScope: { kind: 'project', projectPath: action.path },
          projectPath: action.path,
          projectTrusted: action.trusted,
          projectTrustPending: false,
          trustDialogOpen: !action.trusted,
          // Keep the already-painted folder rows. Wiping this list makes the
          // sidebar swap onto an empty live source, unmount every session
          // row, then remount after hydrate — the first-click jitter.
          sessions: state.projectSessionsByPath[action.path] ?? [],
          warmSessionCache,
        };
      }
      return {
        ...state,
        activeScope: { kind: 'project', projectPath: action.path },
        projectPath: action.path,
        projectTrusted: action.trusted,
        projectTrustPending: false,
        trustDialogOpen: !action.trusted,
        warmSessionCache,
        // A project owns its own history. Do not leave another project's rows,
        // transcript, or selected session as the send target while this project's
        // index is loading. Composer snapshots park the previous owner separately.
        activeSessionId: null,
        sessions: [],
        transcriptOwnerSessionId: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        compacting: false,
        compactionActivity: null,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        // Subagent activity is scoped to the active parent session; switching
        // scope must not surface another session's children or live streams.
        ...CLEARED_SUBAGENT_UI,
      };
    }
    case 'project/clear': {
      const warmSessionCache = action.keepActiveSession
        ? state.warmSessionCache
        : stashOwnedTranscript(state.warmSessionCache, state);
      if (action.keepActiveSession === true) {
        return {
          ...state,
          activeScope: { kind: 'general' },
          projectPath: null,
          projectTrusted: false,
          projectTrustPending: false,
          trustDialogOpen: false,
          sessions: state.generalSessions,
          warmSessionCache,
        };
      }
      return {
        ...state,
        activeScope: { kind: 'general' },
        projectPath: null,
        projectTrusted: false,
        projectTrustPending: false,
        trustDialogOpen: false,
        warmSessionCache,
        activeSessionId: null,
        sessions: [],
        transcriptOwnerSessionId: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        compacting: false,
        compactionActivity: null,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    }
    case 'project/trust-dialog':
      return { ...state, trustDialogOpen: action.open };
    case 'project/trusted':
      return { ...state, projectTrusted: true, projectTrustPending: false, trustDialogOpen: false };
  }
}
