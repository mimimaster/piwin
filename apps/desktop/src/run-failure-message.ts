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
): { messages: ChatMessageUi[]; stamped: boolean } {
  const messagesWithFailedTools = messages.map(markRunningToolsAsFailed);
  let targetIndex = -1;

  for (let index = messagesWithFailedTools.length - 1; index >= 0; index -= 1) {
    const message = messagesWithFailedTools[index];
    if (!message || message.role !== 'assistant') {
      continue;
    }

    const matchesRun = targetRunId !== null && message.runId === targetRunId;
    const matchesStreamingFallback = includeStreamingFallback && message.status === 'streaming';
    if (matchesRun || matchesStreamingFallback) {
      targetIndex = index;
      break;
    }
  }

  if (targetIndex < 0) {
    return { messages: messagesWithFailedTools, stamped: false };
  }

  return {
    messages: messagesWithFailedTools.map((message, index) =>
      index === targetIndex
        ? {
            ...message,
            status: 'error' as const,
            error: preserveExistingError ? (message.error ?? errorMessage) : errorMessage,
          }
        : message,
    ),
    stamped: true,
  };
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
