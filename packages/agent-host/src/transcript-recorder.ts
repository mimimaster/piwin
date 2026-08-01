/**
 * Map AgentEvent stream into product transcript mutations.
 * Used by HostRuntime so UI can hydrate after process restart.
 */
import type {
  AgentEvent,
  MediaAttachmentRef,
  PromptInput,
  SessionTranscriptDocument,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  appendToolCard,
  createAssistantTranscriptMessage,
  createUserTranscriptMessage,
  loadSessionTranscript,
  saveSessionTranscriptAtomic,
} from '@piwin/session';

export type TranscriptRecorder = {
  recordUserPrompt: (input: PromptInput) => Promise<void>;
  recordEvent: (event: AgentEvent) => Promise<void>;
  flush: () => Promise<void>;
};

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_TOOL_OUTPUT_BYTES = 256 * 1024;
const TOOL_OUTPUT_TRUNCATION_MARKER = '\n[output truncated: retention limit reached]';

export function createTranscriptRecorder(options: {
  transcriptPath: string;
  sessionId: string;
  projectPath: string;
  flushIntervalMs?: number;
  maxToolOutputBytes?: number;
  onError?: (error: unknown) => void;
}): TranscriptRecorder {
  let lastAssistantId: string | null = null;
  const assistantIdsByRunId = new Map<string, string>();
  let writeQueue: Promise<void> = Promise.resolve();
  let document: SessionTranscriptDocument | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let flushPromise: Promise<void> | null = null;
  let backgroundFlushError: unknown = null;
  let documentRevision = 0;
  let persistedRevision = 0;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxToolOutputBytes = validateToolOutputLimit(
    options.maxToolOutputBytes ?? DEFAULT_MAX_TOOL_OUTPUT_BYTES,
  );

  function enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const queuedWrite = writeQueue.then(operation, operation);
    writeQueue = queuedWrite.catch(() => undefined);
    return queuedWrite;
  }

  async function ensureDocument(): Promise<SessionTranscriptDocument> {
    if (document) {
      return document;
    }
    document = await loadSessionTranscript(options.transcriptPath);
    if (!document) {
      document = {
        version: 1,
        sessionId: options.sessionId,
        projectPath: options.projectPath,
        messages: [],
        updatedAt: new Date().toISOString(),
      };
    } else if (!document.projectPath && options.projectPath) {
      document.projectPath = options.projectPath;
    }
    return document;
  }

  async function persistDocument(): Promise<void> {
    const currentDocument = await ensureDocument();
    const revisionBeingPersisted = documentRevision;
    currentDocument.updatedAt = new Date().toISOString();
    await saveSessionTranscriptAtomic(options.transcriptPath, currentDocument);
    persistedRevision = revisionBeingPersisted;
  }

  function scheduleFlush(): void {
    if (flushTimer !== undefined || flushPromise !== null) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      flushPromise = enqueueWrite(async () => {
        await persistDocument();
      })
        .catch((error: unknown) => {
          backgroundFlushError = error;
          options.onError?.(error);
          throw error;
        })
        .finally(() => {
          flushPromise = null;
          if (documentRevision > persistedRevision) {
            scheduleFlush();
          }
        });
      // The error is retained and surfaced by the next explicit flush().
      void flushPromise.catch(() => undefined);
    }, flushIntervalMs);
    flushTimer.unref?.();
  }

  function findMessage(messageId: string): SessionTranscriptMessage | undefined {
    return document?.messages.find((message) => message.id === messageId);
  }

  function updateMessage(
    messageId: string,
    update: (message: SessionTranscriptMessage) => SessionTranscriptMessage,
  ): void {
    const message = findMessage(messageId);
    if (!message || !document) {
      return;
    }
    const messageIndex = document.messages.findIndex((item) => item.id === messageId);
    if (messageIndex >= 0) {
      document.messages[messageIndex] = update(message);
      documentRevision += 1;
    }
  }

  function findAssistantIdForRun(runId: string): string | undefined {
    const mappedMessageId = assistantIdsByRunId.get(runId);
    if (mappedMessageId) {
      return mappedMessageId;
    }
    return document?.messages.find((message) => message.runId === runId)?.id;
  }

  return {
    async recordUserPrompt(input) {
      const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const messageInput: Parameters<typeof createUserTranscriptMessage>[0] = {
        id: userId,
        text: input.text,
      };
      if (input.attachments && input.attachments.length > 0) {
        // The transcript schema is still media-only; web-element attachments
        // land here once the browser session ships (Task 2/3) and widen it.
        const mediaAttachments = input.attachments.filter(
          (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
        );
        if (mediaAttachments.length > 0) {
          messageInput.attachments = mediaAttachments;
        }
      }
      const message = createUserTranscriptMessage(messageInput);
      await enqueueWrite(async () => {
        const currentDocument = await ensureDocument();
        const existingIndex = currentDocument.messages.findIndex((item) => item.id === message.id);
        if (existingIndex === -1) {
          currentDocument.messages.push(message);
        } else {
          currentDocument.messages[existingIndex] = message;
        }
        documentRevision += 1;
        await persistDocument();
      });
    },

    async recordEvent(event) {
      await enqueueWrite(async () => {
        await ensureDocument();

        switch (event.type) {
          case 'message/start': {
            if (event.role === 'assistant') {
              lastAssistantId = event.messageId;
              const message = createAssistantTranscriptMessage({ id: event.messageId });
              if (event.runId) {
                message.runId = event.runId;
                assistantIdsByRunId.set(event.runId, event.messageId);
              }
              const currentDocument = document;
              if (!currentDocument) {
                throw new Error('transcript document was not initialized');
              }
              // Lifecycle events can be replayed across SDK subscription
              // recovery. One message id must map to exactly one transcript row.
              if (!currentDocument.messages.some((item) => item.id === event.messageId)) {
                currentDocument.messages.push(message);
                documentRevision += 1;
              }
              await persistDocument();
            }
            break;
          }
          case 'message/text_delta': {
            updateMessage(event.messageId, (message) => ({
              ...message,
              text: message.text + event.delta,
              status: 'streaming',
            }));
            scheduleFlush();
            break;
          }
          case 'message/thinking_delta': {
            updateMessage(event.messageId, (message) => ({
              ...message,
              thinking: (message.thinking ?? '') + event.delta,
            }));
            scheduleFlush();
            break;
          }
          case 'message/end': {
            updateMessage(event.messageId, (message) => ({ ...message, status: 'done' }));
            const currentDocument = document;
            const messageIndex = currentDocument?.messages.findIndex(
              (message) => message.id === event.messageId,
            ) ?? -1;
            const completedMessage =
              messageIndex >= 0 ? currentDocument?.messages[messageIndex] : undefined;
            // The Pi SDK may emit empty assistant lifecycle entries while
            // scheduling internal work. Keep actual thinking/tool activity,
            // but do not persist a visible assistant turn with no content.
            if (
              completedMessage?.role === 'assistant' &&
              completedMessage.text.trim().length === 0 &&
              (completedMessage.thinking ?? '').trim().length === 0 &&
              (completedMessage.tools?.length ?? 0) === 0
            ) {
              currentDocument?.messages.splice(messageIndex, 1);
              documentRevision += 1;
            }
            await persistDocument();
            break;
          }
          case 'tool/start': {
            const assistantId = event.runId
              ? assistantIdsByRunId.get(event.runId)
              : lastAssistantId;
            if (!assistantId) break;
            updateMessage(assistantId, (message) => ({
              ...message,
              tools: appendToolCard(message.tools, {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: 'running',
                output: '',
                ...(event.runId ? { runId: event.runId } : {}),
                ...(event.presentation ? { presentation: event.presentation } : {}),
              }),
            }));
            await persistDocument();
            break;
          }
          case 'tool/update': {
            const assistantId = event.runId
              ? assistantIdsByRunId.get(event.runId)
              : lastAssistantId;
            if (!assistantId) break;
            updateMessage(assistantId, (message) => ({
              ...message,
              tools: (message.tools ?? []).map((tool) =>
                tool.toolCallId === event.toolCallId &&
                (event.runId === undefined || tool.runId === undefined || tool.runId === event.runId)
                  ? {
                      ...tool,
                      output:
                        event.presentation?.output?.text ??
                        appendBoundedToolOutput(tool.output, event.delta, maxToolOutputBytes),
                      ...(event.presentation
                        ? { presentation: { ...tool.presentation, ...event.presentation } }
                        : {}),
                    }
                  : tool,
              ),
            }));
            break;
          }
          case 'tool/end': {
            const assistantId = event.runId
              ? assistantIdsByRunId.get(event.runId)
              : lastAssistantId;
            if (!assistantId) break;
            updateMessage(assistantId, (message) => ({
              ...message,
              tools: (message.tools ?? []).map((tool) =>
                tool.toolCallId === event.toolCallId &&
                (event.runId === undefined || tool.runId === undefined || tool.runId === event.runId)
                  ? {
                      ...tool,
                      status: event.isError ? ('error' as const) : ('done' as const),
                      ...(event.presentation
                        ? { presentation: { ...tool.presentation, ...event.presentation } }
                        : {}),
                    }
                  : tool,
              ),
            }));
            await persistDocument();
            break;
          }
          case 'error': {
            if (lastAssistantId) {
              updateMessage(lastAssistantId, (message) => ({ ...message, status: 'error' }));
              await persistDocument();
            }
            break;
          }
          case 'run/phase': {
            const assistantId = findAssistantIdForRun(event.runId);
            if (!assistantId) break;
            updateMessage(assistantId, (message) => ({
              ...message,
              phaseHistory: [
                ...(message.phaseHistory ?? []),
                {
                  phase: event.phase,
                  at: event.at,
                  ...(event.detail ? { detail: event.detail } : {}),
                },
              ],
              startedAt: message.startedAt ?? event.at,
            }));
            scheduleFlush();
            break;
          }
          case 'run/terminal': {
            const assistantId = findAssistantIdForRun(event.runId);
            if (!assistantId) break;
            updateMessage(assistantId, (message) => ({
              ...message,
              endedAt: event.at,
              outcome: event.outcome,
              ...(event.message ? { terminalMessage: event.message } : {}),
              status: event.outcome === 'failed' ? 'error' : 'done',
            }));
            await persistDocument();
            break;
          }
          default:
            break;
        }
      });
    },

    async flush() {
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (backgroundFlushError !== null) {
        const error = backgroundFlushError;
        backgroundFlushError = null;
        throw error;
      }
      do {
        await enqueueWrite(async () => {
          await persistDocument();
        });
        await writeQueue;
      } while (documentRevision > persistedRevision);
    },
  };
}

function validateToolOutputLimit(maxToolOutputBytes: number): number {
  if (
    !Number.isSafeInteger(maxToolOutputBytes) ||
    maxToolOutputBytes < Buffer.byteLength(TOOL_OUTPUT_TRUNCATION_MARKER, 'utf8')
  ) {
    throw new RangeError('maxToolOutputBytes must fit the tool output truncation marker');
  }
  return maxToolOutputBytes;
}

function appendBoundedToolOutput(
  existingOutput: string,
  nextOutput: string,
  maxToolOutputBytes: number,
): string {
  if (existingOutput.endsWith(TOOL_OUTPUT_TRUNCATION_MARKER)) {
    return existingOutput;
  }

  const combinedOutputBytes =
    Buffer.byteLength(existingOutput, 'utf8') + Buffer.byteLength(nextOutput, 'utf8');
  if (combinedOutputBytes <= maxToolOutputBytes) {
    return existingOutput + nextOutput;
  }

  const markerBytes = Buffer.byteLength(TOOL_OUTPUT_TRUNCATION_MARKER, 'utf8');
  const retainedBytes = maxToolOutputBytes - markerBytes;
  const existingPrefix = truncateUtf8(existingOutput, retainedBytes);
  const remainingBytes = retainedBytes - Buffer.byteLength(existingPrefix, 'utf8');
  const nextPrefix = truncateUtf8(nextOutput, remainingBytes);
  return existingPrefix + nextPrefix + TOOL_OUTPUT_TRUNCATION_MARKER;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }
  return Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8');
}
