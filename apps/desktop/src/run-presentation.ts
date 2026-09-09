/** Pure projection of one assistant turn into a coding-agent work record. */
import type { SessionRunOutcome, SessionRunPhase } from '@piwin/contracts';
import type { ChatMessageUi, PermissionPromptUi, RunRecordUi, ToolCardUi } from './chat-reducer';

export type RunPhaseView = {
  phase: SessionRunPhase;
  at: number;
  detail?: string;
};

export type WorkItemView =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; tool: ToolCardUi }
  | { kind: 'permission'; action: string; detail: string };

export type TurnPresentation = {
  runId: string | null;
  phaseHistory: RunPhaseView[];
  startedAt?: number;
  endedAt?: number;
  outcome?: SessionRunOutcome;
  terminalMessage?: string;
  workItems: WorkItemView[];
  hasFailure: boolean;
  isActive: boolean;
  /** True only while this response is still emitting reasoning. */
  isThinkingActive: boolean;
  /** True when assistant answer text has started (the default keeps work collapsed). */
  answerStarted: boolean;
  /** Waiting for first model output (no thinking/tools yet). */
  isWaitingForModel: boolean;
  permissionState?: { action: string; detail: string };
  summaryLabel: string;
  /** Elapsed thinking/work seconds when known. */
  thoughtSeconds?: number;
  toolCallCount: number;
};

export type BuildTurnPresentationInput = {
  message: ChatMessageUi;
  runRecordsById: Record<string, RunRecordUi>;
  activeRunId: string | null;
  permissionPrompt: PermissionPromptUi | null;
  /** Summary chip locale — defaults to English for pure-logic tests. */
  locale?: 'zh-CN' | 'en';
};

export function buildTurnPresentation(input: BuildTurnPresentationInput): TurnPresentation {
  const { message, runRecordsById, activeRunId, permissionPrompt } = input;
  const locale = input.locale ?? 'en';
  const runId = message.runId ?? null;
  const runRecord = runId ? runRecordsById[runId] : undefined;
  const workItems: WorkItemView[] = [];

  if (message.thinking.trim()) {
    workItems.push({ kind: 'thinking', text: message.thinking });
  }
  for (const tool of message.tools) {
    workItems.push({ kind: 'tool', tool });
  }

  const isActive =
    message.status === 'streaming' ||
    (runId !== null && activeRunId === runId) ||
    message.tools.some((tool) => tool.status === 'running');
  const answerStarted = message.text.trim().length > 0;
  const isThinkingActive =
    isActive &&
    message.status === 'streaming' &&
    message.thinking.trim().length > 0 &&
    message.thinkingEndedAt === undefined &&
    !answerStarted &&
    message.tools.length === 0;
  const permissionForThisTurn =
    permissionPrompt &&
    (permissionPrompt.runId === undefined ||
      permissionPrompt.runId === runId ||
      (runId === null && isActive))
      ? permissionPrompt
      : null;

  if (permissionForThisTurn) {
    workItems.push({
      kind: 'permission',
      action: permissionForThisTurn.action,
      detail: permissionForThisTurn.detail,
    });
  }

  const latestPhase = runRecord?.phaseHistory[runRecord.phaseHistory.length - 1]?.phase;
  // Keep a live waiting chrome for every empty active turn. Host often advances
  // through `preparing` / early `streaming` before any thinking, tool, or answer
  // token exists — gating only on a few early phases left Agent bubbles blank.
  const isWaitingForModel =
    isActive &&
    !answerStarted &&
    !message.thinking.trim() &&
    message.tools.length === 0 &&
    !permissionForThisTurn &&
    latestPhase !== 'tool-running' &&
    latestPhase !== 'waiting-permission' &&
    latestPhase !== 'pausing' &&
    latestPhase !== 'cancelling';

  const phaseHistory: RunPhaseView[] = (runRecord?.phaseHistory ?? []).map((entry) => ({
    phase: entry.phase,
    at: entry.at,
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
  }));
  const hasFailure =
    message.status === 'error' ||
    message.tools.some((tool) => tool.status === 'error') ||
    runRecord?.outcome === 'failed';
  const toolCallCount = message.tools.length;
  const thoughtSeconds = resolveThoughtSeconds(message, isThinkingActive);
  const presentation: TurnPresentation = {
    runId,
    phaseHistory,
    workItems,
    hasFailure,
    isActive,
    isThinkingActive,
    answerStarted,
    isWaitingForModel,
    toolCallCount,
    summaryLabel: buildSummaryLabel({
      isActive,
      isThinkingActive,
      isWaitingForModel,
      answerStarted,
      hasFailure,
      tools: message.tools,
      thinkingLength: message.thinking.trim().length,
      phaseCount: phaseHistory.length,
      toolCallCount,
      locale,
      ...(thoughtSeconds !== undefined ? { thoughtSeconds } : {}),
      ...(runRecord?.outcome ? { outcome: runRecord.outcome } : {}),
    }),
  };

  if (runRecord?.startedAt !== null && runRecord?.startedAt !== undefined) {
    presentation.startedAt = runRecord.startedAt;
  }
  if (runRecord?.endedAt !== null && runRecord?.endedAt !== undefined) {
    presentation.endedAt = runRecord.endedAt;
  }
  if (thoughtSeconds !== undefined) {
    presentation.thoughtSeconds = thoughtSeconds;
  }
  if (runRecord?.outcome) {
    presentation.outcome = runRecord.outcome;
  }
  if (runRecord?.terminalMessage) {
    presentation.terminalMessage = runRecord.terminalMessage;
  }
  if (permissionForThisTurn) {
    presentation.permissionState = {
      action: permissionForThisTurn.action,
      detail: permissionForThisTurn.detail,
    };
  }
  return presentation;
}

export function resolveWorkDetailsDefaultOpen(
  presentation: TurnPresentation,
  preference: 'auto' | 'always' | 'collapsed',
): boolean {
  if (preference === 'always') return true;
  if (preference === 'collapsed') return false;
  // Keep the default transcript compact while preserving an explicit "always"
  // preference and useful failure details. The summary row supplies the live
  // thinking signal while the full reasoning remains user-expandable.
  if (presentation.hasFailure) return true;
  return false;
}

function resolveThoughtSeconds(
  message: ChatMessageUi,
  isThinkingActive: boolean,
): number | undefined {
  if (message.thinkingStartedAt === undefined) return undefined;
  const thinkingEnd = message.thinkingEndedAt ?? (isThinkingActive ? Date.now() : undefined);
  if (thinkingEnd === undefined) return undefined;
  const elapsedMs = Math.max(0, thinkingEnd - message.thinkingStartedAt);
  return Math.max(1, Math.round(elapsedMs / 1000));
}

function buildSummaryLabel(input: {
  isActive: boolean;
  isThinkingActive: boolean;
  isWaitingForModel: boolean;
  answerStarted: boolean;
  hasFailure: boolean;
  outcome?: SessionRunOutcome;
  tools: ToolCardUi[];
  thinkingLength: number;
  phaseCount: number;
  toolCallCount: number;
  thoughtSeconds?: number;
  locale: 'zh-CN' | 'en';
}): string {
  const isChinese = input.locale === 'zh-CN';
  if (input.isActive) {
    if (input.isWaitingForModel) {
      return isChinese ? '正在连接模型…' : 'Connecting to model…';
    }
    const runningTool = input.tools.find((tool) => tool.status === 'running');
    if (runningTool) {
      const toolTitle = runningTool.presentation?.title ?? runningTool.toolName;
      return isChinese ? `工作中 · ${toolTitle}` : `Working · ${toolTitle}`;
    }
    if (input.isThinkingActive) {
      return isChinese ? '思考中' : 'Thinking';
    }
    return isChinese ? '工作中…' : 'Working…';
  }
  if (input.hasFailure || input.outcome === 'failed') {
    const failedCount = input.tools.filter((tool) => tool.status === 'error').length;
    if (failedCount > 0) {
      return isChinese
        ? `失败 · ${failedCount} 次工具调用`
        : `Failed · ${failedCount} tool${failedCount === 1 ? '' : 's'}`;
    }
    return isChinese ? '失败' : 'Failed';
  }
  if (input.outcome === 'cancelled') {
    return isChinese ? '已停止' : 'Stopped';
  }

  const seconds = input.thoughtSeconds;
  const toolCount = input.toolCallCount;
  if (seconds !== undefined) {
    if (isChinese) {
      return `已思考 ${seconds} 秒 · ${toolCount} 次工具调用`;
    }
    return `Thought for ${seconds}s · ${toolCount} tool call${toolCount === 1 ? '' : 's'}`;
  }
  if (input.thinkingLength > 0) {
    if (toolCount > 0) {
      return isChinese
        ? `思考过程 · ${toolCount} 次工具调用`
        : `Thoughts · ${toolCount} tool call${toolCount === 1 ? '' : 's'}`;
    }
    return isChinese ? '思考过程' : 'Thoughts';
  }
  if (toolCount > 0) {
    return isChinese
      ? `${toolCount} 次工具调用`
      : `${toolCount} tool call${toolCount === 1 ? '' : 's'}`;
  }
  return isChinese ? '工作详情' : 'Work details';
}
