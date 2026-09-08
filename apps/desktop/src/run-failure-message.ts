import type { AgentFailure } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';

/**
 * Attach a run-level failure to one assistant response only.
 *
 * A single run can contain several assistant responses because each tool
 * round produces another response. The run still has one user-visible
 * failure, so older responses must remain intact and the latest response is
 * the only one that receives the failure state.
 */
export function markLatestAssistantFailure(
  messages: readonly ChatMessageUi[],
  targetRunId: string | null,
  errorMessage: string,
  includeStreamingFallback: boolean,
  preserveExistingError = false,
  extras?: { failure?: AgentFailure; stampStatus?: boolean },
): { messages: ChatMessageUi[]; stamped: boolean } {
  let targetIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') {
      continue;
    }

    const matchesRun = targetRunId !== null && message.runId === targetRunId;
    const matchesStreamingFallback =
      includeStreamingFallback &&
      message.status === 'streaming' &&
      (message.runId === undefined || message.runId === targetRunId);
    if (matchesRun || matchesStreamingFallback) {
      targetIndex = index;
      break;
    }
  }

  if (targetIndex < 0) {
    return { messages: [...messages], stamped: false };
  }

  return {
    messages: messages.map((message, index) => {
      const belongsToFailedRun =
        targetRunId !== null
          ? message.runId === targetRunId
          : index === targetIndex;
      const withFailedTools = belongsToFailedRun ? markRunningToolsAsFailed(message) : message;
      if (index !== targetIndex) {
        return withFailedTools;
      }
      return {
        ...withFailedTools,
        ...(extras?.stampStatus === false ? {} : { status: 'error' as const }),
        error: preserveExistingError ? (withFailedTools.error ?? errorMessage) : errorMessage,
        ...(extras?.failure === undefined ? {} : { failure: extras.failure }),
      };
    }),
    stamped: true,
  };
}

/**
 * Make a failed Run visible in the transcript.
 *
 * Stamp this Run's own assistant when one exists. If the provider died
 * before any reply, append a new error bubble bound to this Run — never
 * reuse the previous turn's completed assistant. That older row still
 * belongs to a completed Run, so TurnErrorCard would hide the failure.
 */
export function ensureFailedRunAssistant(
  messages: readonly ChatMessageUi[],
  runId: string,
  errorMessage: string,
  extras?: { failure?: AgentFailure },
): ChatMessageUi[] {
  const byRun = markLatestAssistantFailure(
    messages,
    runId,
    errorMessage,
    false,
    true,
    extras,
  );
  if (byRun.stamped) {
    return byRun.messages;
  }

  let lastAssistant: ChatMessageUi | undefined;
  for (let index = byRun.messages.length - 1; index >= 0; index -= 1) {
    const candidate = byRun.messages[index];
    if (candidate?.role === 'assistant') {
      lastAssistant = candidate;
      break;
    }
  }
  if (
    lastAssistant !== undefined &&
    lastAssistant.status === 'streaming' &&
    (lastAssistant.runId === undefined || lastAssistant.runId === runId)
  ) {
    const liveAssistantId = lastAssistant.id;
    const stampedLive = markLatestAssistantFailure(
      byRun.messages,
      runId,
      errorMessage,
      true,
      true,
      extras,
    );
    if (stampedLive.stamped) {
      return stampedLive.messages.map((message) =>
        message.id === liveAssistantId && message.runId === undefined
          ? { ...message, runId }
          : message,
      );
    }
  }

  return [
    ...byRun.messages,
    {
      id: `piw-m-error-${runId}`,
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'error',
      error: errorMessage,
      runId,
      ...(extras?.failure === undefined ? {} : { failure: extras.failure }),
    },
  ];
}

function markRunningToolsAsFailed(message: ChatMessageUi): ChatMessageUi {
  let changed = false;
  const tools = message.tools.map((tool) => {
    if (tool.status !== 'running') {
      return tool;
    }
    changed = true;
    return { ...tool, status: 'error' as const };
  });

  return changed ? { ...message, tools } : message;
}
