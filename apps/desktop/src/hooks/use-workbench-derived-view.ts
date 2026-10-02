/**
 * Derived transcript/chrome values for the workbench view.
 */
import { useMemo } from 'react';
import type { JobRecord, SessionPlan } from '@piwin/contracts';
import type { ChatUiState } from '../chat-reducer';
import {
  estimateTranscriptTokens,
  isChatCompactPendingOccupancy,
  selectContextRingView,
} from '../context-telemetry-selector.js';
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

  const activeSessionItem = state.activeSessionId
    ? (state.sessionEntitiesById[state.activeSessionId] ??
       state.sessions.find((item) => item.id === state.activeSessionId) ??
       state.generalSessions.find((item) => item.id === state.activeSessionId))
    : undefined;
  const activeBackend = activeSessionItem?.backend;
  const backendOptions = state.activeSessionId
    ? state.backendOptionsBySession[state.activeSessionId]
    : undefined;
  const isExternalBackend =
    (activeBackend !== undefined && activeBackend.agentId !== 'pi') ||
    backendOptions !== undefined;
  const selectedBackendModel = backendOptions?.models.find(
    (model) => model.id === backendOptions?.currentModelId,
  );
  const effectiveModelContextWindow =
    selectedBackendModel?.contextTokens ??
    (typeof selectedModelContextWindow === 'number'
      ? selectedModelContextWindow
      : isExternalBackend
        ? 256_000
        : undefined);

  const fallbackTokensUsed = useMemo(() => {
    if (!isExternalBackend || state.messages.length === 0) return 0;
    return estimateTranscriptTokens(state.messages);
  }, [isExternalBackend, state.messages]);

  const contextUsagePercent = useMemo(
    () =>
      selectContextRingView({
        telemetry: state.contextTelemetry,
        locale: desktopLocale === 'en' ? 'en' : 'zh-CN',
        ...(typeof effectiveModelContextWindow === 'number'
          ? { selectedModelContextWindow: effectiveModelContextWindow }
          : {}),
        ...(state.compacting ? { compacting: true } : {}),
        ...(isChatCompactPendingOccupancy(state) ? { compactPendingOccupancy: true } : {}),
        ...(isExternalBackend && (fallbackTokensUsed > 0 || (state.contextUsage?.tokensUsed ?? 0) > 0)
          ? {
              fallbackUsage: {
                tokensUsed: state.contextUsage?.tokensUsed ?? fallbackTokensUsed,
                ...(typeof effectiveModelContextWindow === 'number'
                  ? { tokensLimit: effectiveModelContextWindow }
                  : {}),
                quality: 'estimated' as const,
              },
            }
          : {}),
      }).percentText,
    [
      state.contextTelemetry,
      state.compacting,
      state.lastCompactionMessage,
      state.contextUsage,
      selectedModelContextWindow,
      effectiveModelContextWindow,
      fallbackTokensUsed,
      isExternalBackend,
      desktopLocale,
    ],
  );
  const lastUserMessage = useMemo(() => findLastUserMessage(state.messages), [state.messages]);
  const lastUserMessageId = lastUserMessage?.id ?? null;
  const activeSessionListItem =
    state.activeSessionMetadata ??
    state.sessions.find((item) => item.id === state.activeSessionId) ??
    null;
  const activeSessionName =
    activeSessionListItem?.name ?? (desktopLocale === 'zh-CN' ? '素笺' : 'Clean Slate');
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
