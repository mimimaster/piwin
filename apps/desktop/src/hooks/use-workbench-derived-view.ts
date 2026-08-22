/**
 * Derived transcript/chrome values for the workbench view.
 */
import { useMemo } from 'react';
import type { JobRecord, SessionPlan } from '@piwin/contracts';
import type { ChatUiState } from '../chat-reducer';
import { computeContextUsagePercent } from '../context-usage-ring';
import type { DesktopLocale } from '../desktop-locale';
import { deriveRunStatus } from '../run-status';
import { collectSessionTools } from '../tool-call-card';
import { findLastUserMessage, transcriptActivitySignal } from '../workbench-chrome-assembly';

export function useWorkbenchDerivedView(input: {
  state: ChatUiState;
  sessionPlan: SessionPlan | null;
  jobs: JobRecord[];
  desktopLocale: DesktopLocale;
  runClock: number;
  selectedModelContextWindow: number | undefined;
}) {
  const { state, sessionPlan, jobs, desktopLocale, runClock, selectedModelContextWindow } = input;
  const sessionTools = useMemo(() => collectSessionTools(state.messages), [state.messages]);
  const runStatus = useMemo(
    () =>
      deriveRunStatus({
        chat: state,
        tools: sessionTools,
        plan: sessionPlan,
        jobs,
        locale: desktopLocale,
      }),
    [state, sessionTools, sessionPlan, jobs, runClock, desktopLocale],
  );
  const activitySignal = useMemo(
    () =>
      transcriptActivitySignal({
        runPhase: state.runPhase,
        messages: state.messages,
        tools: sessionTools,
      }),
    [state.runPhase, state.messages, sessionTools],
  );
  const historyViewActive = state.historyView !== null;
  const visibleTranscriptMessages = state.historyView?.messages ?? state.messages;
  const visibleRunRecordsById = state.historyView?.runRecordsById ?? state.runRecordsById;
  const contextUsagePercent = useMemo(
    () => computeContextUsagePercent(state.contextUsage, selectedModelContextWindow),
    [state.contextUsage, selectedModelContextWindow],
  );
  const lastUserMessage = useMemo(() => findLastUserMessage(state.messages), [state.messages]);
  const lastUserMessageId = lastUserMessage?.id ?? null;
  const activeSessionListItem =
    state.activeSessionMetadata ??
    state.sessions.find((item) => item.id === state.activeSessionId) ??
    null;
  const activeSessionName = activeSessionListItem?.name ?? 'New chat';
  const activeSessionOrigin = activeSessionListItem?.origin ?? null;
  return {
    sessionTools,
    runStatus,
    activitySignal,
    historyViewActive,
    visibleTranscriptMessages,
    visibleRunRecordsById,
    contextUsagePercent,
    lastUserMessage,
    lastUserMessageId,
    activeSessionName,
    activeSessionOrigin,
  };
}
