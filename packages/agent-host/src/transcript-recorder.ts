/**
 * Map AgentEvent stream into product transcript mutations.
 * Used by HostRuntime so UI can hydrate after process restart.
 */
import type {
  AgentEvent,
  PromptInput,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  appendToolCard,
  appendTranscriptMessage,
  createAssistantTranscriptMessage,
  createUserTranscriptMessage,
  loadSessionTranscript,
  patchTranscriptMessage,
  saveSessionTranscript,
} from '@piwin/session';

export type TranscriptRecorder = {
  recordUserPrompt: (input: PromptInput) => Promise<void>;
  recordEvent: (event: AgentEvent) => Promise<void>;
};

export function createTranscriptRecorder(options: {
  transcriptPath: string;
  sessionId: string;
  projectPath: string;
}): TranscriptRecorder {
  let lastAssistantId: string | null = null;

  return {
    async recordUserPrompt(input) {
      const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const messageInput: Parameters<typeof createUserTranscriptMessage>[0] = {
        id: userId,
        text: input.text,
      };
      if (input.attachments && input.attachments.length > 0) {
        messageInput.attachments = input.attachments;
      }
      const message = createUserTranscriptMessage(messageInput);
      await appendTranscriptMessage(
        options.transcriptPath,
        options.sessionId,
        options.projectPath,
        message,
      );
    },

    async recordEvent(event) {
      const path = options.transcriptPath;
      const sessionId = options.sessionId;
      const projectPath = options.projectPath;

      switch (event.type) {
        case 'message/start': {
          if (event.role === 'assistant') {
            lastAssistantId = event.messageId;
            const message = createAssistantTranscriptMessage({ id: event.messageId });
            await appendTranscriptMessage(path, sessionId, projectPath, message);
          }
          break;
        }
        case 'message/text_delta': {
          await mutateAssistant(path, sessionId, projectPath, event.messageId, (message) => ({
            ...message,
            text: message.text + event.delta,
            status: 'streaming',
          }));
          break;
        }
        case 'message/thinking_delta': {
          await mutateAssistant(path, sessionId, projectPath, event.messageId, (message) => ({
            ...message,
            thinking: (message.thinking ?? '') + event.delta,
          }));
          break;
        }
        case 'message/end': {
          await patchTranscriptMessage(path, sessionId, projectPath, event.messageId, {
            status: 'done',
          });
          break;
        }
        case 'tool/start': {
          if (!lastAssistantId) break;
          await mutateAssistant(path, sessionId, projectPath, lastAssistantId, (message) => ({
            ...message,
            tools: appendToolCard(message.tools, {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              status: 'running',
              output: '',
            }),
          }));
          break;
        }
        case 'tool/update': {
          if (!lastAssistantId) break;
          await mutateAssistant(path, sessionId, projectPath, lastAssistantId, (message) => ({
            ...message,
            tools: (message.tools ?? []).map((tool) =>
              tool.toolCallId === event.toolCallId
                ? { ...tool, output: tool.output + event.delta }
                : tool,
            ),
          }));
          break;
        }
        case 'tool/end': {
          if (!lastAssistantId) break;
          await mutateAssistant(path, sessionId, projectPath, lastAssistantId, (message) => ({
            ...message,
            tools: (message.tools ?? []).map((tool) =>
              tool.toolCallId === event.toolCallId
                ? {
                    ...tool,
                    status: event.isError ? ('error' as const) : ('done' as const),
                  }
                : tool,
            ),
          }));
          break;
        }
        case 'error': {
          if (lastAssistantId) {
            await patchTranscriptMessage(path, sessionId, projectPath, lastAssistantId, {
              status: 'error',
            });
          }
          break;
        }
        default:
          break;
      }
    },
  };
}

async function mutateAssistant(
  path: string,
  sessionId: string,
  projectPath: string,
  messageId: string,
  update: (message: SessionTranscriptMessage) => SessionTranscriptMessage,
): Promise<void> {
  const document = await loadSessionTranscript(path);
  if (!document) {
    return;
  }
  const index = document.messages.findIndex((item) => item.id === messageId);
  if (index === -1) {
    return;
  }
  const current = document.messages[index];
  if (!current) {
    return;
  }
  document.messages[index] = update(current);
  document.updatedAt = new Date().toISOString();
  await saveSessionTranscript(path, document);
  void sessionId;
  void projectPath;
}
