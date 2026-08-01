import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentMessageView,
  CreateSessionInput,
  PromptInput,
  SessionCompactResult,
  SessionHandle,
  SessionTranscriptMessage,
  SessionTreeView,
} from '@piwin/contracts';
import { estimateMockUsage } from './usage-map.js';

type Listener = (event: AgentEvent) => void;

export type CreateMockSessionOptions = CreateSessionInput & {
  /** Stable product session id for cross-process resume. */
  sessionId?: string;
  /** Seed messages shown after resume (not re-emitted as events). */
  seedMessages?: SessionTranscriptMessage[];
};

/**
 * Offline SessionHandle for CLI --mock and unit tests.
 * Emits a deterministic text stream without calling Pi or network.
 */
export function createMockSessionHandle(input: CreateMockSessionOptions): SessionHandle {
  const sessionId = input.sessionId ?? randomUUID();
  const listeners = new Set<Listener>();
  const messages: AgentMessageView[] = (input.seedMessages ?? []).map(transcriptToView);
  let aborted = false;
  let autoCompactionEnabled = true;
  let compacting = false;

  const emit = (event: AgentEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  return {
    id: sessionId,
    async prompt(promptInput: PromptInput): Promise<void> {
      aborted = false;
      const userMessageId = randomUUID();
      const assistantMessageId = randomUUID();
      const userText = promptInput.text.trim() || '(empty)';

      const userMessage: AgentMessageView = {
        id: userMessageId,
        role: 'user',
        text: userText,
        createdAt: new Date().toISOString(),
      };
      if (promptInput.attachments && promptInput.attachments.length > 0) {
        userMessage.attachments = promptInput.attachments;
      }
      messages.push(userMessage);

      emit({ type: 'message/start', messageId: userMessageId, role: 'user' });
      emit({ type: 'message/end', messageId: userMessageId });

      if (aborted) {
        return;
      }

      const locationLabel = resolveMockLocationLabel(input);
      const reply = buildMockReply(userText, locationLabel);
      messages.push({
        id: assistantMessageId,
        role: 'assistant',
        text: reply,
        createdAt: new Date().toISOString(),
      });

      emit({ type: 'message/start', messageId: assistantMessageId, role: 'assistant' });

      const toolCallId = randomUUID();
      emit({ type: 'tool/start', toolCallId, toolName: 'mock_echo' });
      emit({ type: 'tool/update', toolCallId, delta: `echo: ${userText.slice(0, 80)}` });
      emit({ type: 'tool/end', toolCallId, isError: false });

      let assembled = '';
      for (const chunk of chunkText(reply, 24)) {
        if (aborted) {
          const existing = messages.find((message) => message.id === assistantMessageId);
          if (existing) {
            existing.text = assembled;
          }
          emit({
            type: 'session/aborted',
            sessionId,
            messageId: assistantMessageId,
          });
          return;
        }
        assembled += chunk;
        emit({ type: 'message/text_delta', messageId: assistantMessageId, delta: chunk });
        // Yield so concurrent abort() can land between chunks.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 8);
        });
      }

      if (aborted) {
        const existing = messages.find((message) => message.id === assistantMessageId);
        if (existing) {
          existing.text = assembled;
        }
        emit({ type: 'session/aborted', sessionId, messageId: assistantMessageId });
        return;
      }

      emit({ type: 'message/end', messageId: assistantMessageId });
      const usage = estimateMockUsage(sessionId, userText, reply);
      emit({ type: 'usage/update', sessionId, usage });
    },
    async steer(message: string): Promise<void> {
      emit({
        type: 'error',
        message: `mock steer ignored: ${message}`,
        retriable: false,
      });
    },
    async followUp(message: string): Promise<void> {
      await this.prompt({ text: message, streamingBehavior: 'followUp' });
    },
    async abort(): Promise<void> {
      aborted = true;
    },
    async compact(customInstructions?: string): Promise<SessionCompactResult> {
      if (compacting) {
        return { ok: false, message: 'compaction already running' };
      }
      compacting = true;
      const startedAt = Date.now();
      emit({ type: 'compaction/start' });
      await new Promise((resolve) => setTimeout(resolve, 30));
      compacting = false;
      const detail =
        typeof customInstructions === 'string' && customInstructions.trim()
          ? `mock compacted (${customInstructions.trim().slice(0, 80)})`
          : 'mock compacted';
      const durationMs = Date.now() - startedAt;
      const result: SessionCompactResult = {
        ok: true,
        message: detail,
        summary: 'Mock summary of prior turns for UI testing.',
        tokensBefore: 8000,
        tokensAfter: 2500,
        durationMs,
      };
      emit({
        type: 'compaction/end',
        ok: true,
        message: detail,
        summary: 'Mock summary of prior turns for UI testing.',
        tokensBefore: 8000,
        tokensAfter: 2500,
        durationMs,
      });
      return result;
    },
    abortCompaction(): void {
      compacting = false;
      emit({ type: 'compaction/end', ok: false, message: 'compaction aborted' });
    },
    getAutoCompactionEnabled(): boolean {
      return autoCompactionEnabled;
    },
    setAutoCompactionEnabled(enabled: boolean): void {
      autoCompactionEnabled = enabled;
    },
    async getMessages(): Promise<AgentMessageView[]> {
      return [...messages];
    },
    async getTree(): Promise<SessionTreeView> {
      return { root: null, activeLeafId: null };
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function transcriptToView(message: SessionTranscriptMessage): AgentMessageView {
  const view: AgentMessageView = {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
  };
  if (message.attachments && message.attachments.length > 0) {
    view.attachments = message.attachments;
  }
  return view;
}

function resolveMockLocationLabel(input: CreateMockSessionOptions): string {
  if (input.scope?.kind === 'general') {
    return 'general';
  }
  if (input.scope?.kind === 'project') {
    return input.scope.projectPath;
  }
  if (input.projectPath && input.projectPath.trim().length > 0) {
    return input.projectPath;
  }
  return 'general';
}

function buildMockReply(userText: string, projectPath: string): string {
  return [
    'piwin mock host reply.',
    `project: ${projectPath}`,
    `you said: ${userText}`,
    'event pipeline: message/start → tool/* → text_delta → message/end',
  ].join('\n');
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [''];
}
