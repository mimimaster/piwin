import type { ChatMessageUi, RunRecordUi } from './chat-reducer';

export function resolveAssistantRenderingPhase(
  message: ChatMessageUi,
  runRecordsById: Record<string, RunRecordUi>,
  activeRunId: string | null,
): 'streaming' | 'completed' {
  if (message.status === 'streaming' || message.status === 'error') {
    return message.status === 'error' ? 'completed' : 'streaming';
  }
  const runId = message.runId;
  if (!runId) {
    return 'completed';
  }
  if (activeRunId === runId) {
    return 'streaming';
  }
  const record = runRecordsById[runId];
  if (record?.outcome) {
    return 'completed';
  }
  // Hydrated transcripts have terminal message status but may predate run
  // records. A live message still has activeRunId until run/terminal arrives,
  // so this fallback does not enable Artifact rendering early.
  return activeRunId === null ? 'completed' : 'streaming';
}

/**
 * The Pi stream can contain several assistant lifecycle messages for one
 * run. Only the latest one with visible answer text owns the inline caret;
 * tool-only and empty lifecycle messages must not grow their own cursor.
 */
export function findStreamingCaretMessageId(
  messages: readonly ChatMessageUi[],
  runRecordsById: Record<string, RunRecordUi>,
  activeRunId: string | null,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role !== 'assistant' ||
      message.text.trim().length === 0 ||
      resolveAssistantRenderingPhase(message, runRecordsById, activeRunId) !== 'streaming'
    ) {
      continue;
    }
    return message.id;
  }
  return null;
}
