/**
 * Map AgentEvent stream into product transcript mutations.
 * Used by HostRuntime so UI can hydrate after process restart.
 */
import type {
  AgentEvent,
  MediaAttachmentRef,
  ModelRef,
  PromptInput,
  SessionTranscriptDocument,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { mergeSearchEvidence } from '@piwin/contracts';
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
  /**
   * Abandon in-memory state and cancel pending flushes. Used by truncate so a
   * stale recorder cannot rewrite pre-truncation history over the cut file.
   */
  dispose: () => void;
};

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_TOOL_OUTPUT_BYTES = 256 * 1024;
const TOOL_OUTPUT_TRUNCATION_MARKER = '\n[output truncated: retention limit reached]';

/**
 * @deprecated Legacy JSON regression fixture only. Production HostRuntime uses
 * `createStoreTranscriptRecorder`; do not introduce new callers.
 */
export function createTranscriptRecorder(options: {
  transcriptPath: string;
  sessionId: string;
  projectPath: string;
  /**
   * ADR 0040 §7: the runtime generation this recorder persists for. Assistant
   * rows record it as provenance; `message/start` replay is accepted only
   * when the normalized product id AND this provenance match. A naked id
   * collision from a different generation emits a bounded diagnostic and
   * never mutates the older row.
   */
  runtimeGenerationId?: string;
  flushIntervalMs?: number;
  maxToolOutputBytes?: number;
  onError?: (error: unknown) => void;
  /**
   * Diagnostic channel for transcript mutations that are silently dropped
   * (unknown messageId / unmapped runId). Used to surface "model output was
   * generated but never persisted" cases instead of leaving empty bubbles.
   */
  onDiagnostic?: (message: string) => void;
  /**
   * Returns the model snapshot to write onto assistant transcript messages
   * (spec §7.3). Called when an assistant message is created (`message/start`).
   * May return undefined for legacy sessions without a resolved model.
   */
  resolveModel?: () => ModelRef | undefined;
}): TranscriptRecorder {
  let lastAssistantId: string | null = null;
  const assistantIdsByRunId = new Map<string, string>();
  const quarantinedMessageIds = new Set<string>();
  const quarantinedRunIds = new Set<string>();
  let writeQueue: Promise<void> = Promise.resolve();
  let document: SessionTranscriptDocument | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let flushPromise: Promise<void> | null = null;
  let backgroundFlushError: unknown = null;
  let documentRevision = 0;
  let persistedRevision = 0;
  let disposed = false;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxToolOutputBytes = validateToolOutputLimit(
    options.maxToolOutputBytes ?? DEFAULT_MAX_TOOL_OUTPUT_BYTES,
  );

  function enqueueWrite(operation: () => Promise<void>): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }
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
    if (disposed) {
      return;
    }
    const currentDocument = await ensureDocument();
    const revisionBeingPersisted = documentRevision;
    currentDocument.updatedAt = new Date().toISOString();
    await saveSessionTranscriptAtomic(options.transcriptPath, currentDocument);
    persistedRevision = revisionBeingPersisted;
  }

  function scheduleFlush(): void {
    if (disposed) {
      return;
    }
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
    droppedContext?: string,
  ): void {
    const message = findMessage(messageId);
    if (!message || !document) {
      if (droppedContext) {
        options.onDiagnostic?.(
          `transcript delta dropped (${droppedContext}): messageId=${messageId} ` +
            `knownMessages=${document?.messages.length ?? 0}`,
        );
      }
      return;
    }
    const messageIndex = document.messages.findIndex((item) => item.id === messageId);
    if (messageIndex >= 0) {
      document.messages[messageIndex] = update(message);
      documentRevision += 1;
    }
  }

  return {
    async recordUserPrompt(input) {
      const clientMessageId = input.clientMessageId?.trim();
      const userId =
        clientMessageId && clientMessageId.length > 0
          ? clientMessageId
          : `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const messageInput: Parameters<typeof createUserTranscriptMessage>[0] = {
        id: userId,
        text: input.text,
      };
      if (input.attachments && input.attachments.length > 0) {
        // Transcript persistence keeps the path-backed media-compatible
        // attachment union; web-element refs are model-facing only for now.
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
              const message = createAssistantTranscriptMessage({
                id: event.messageId,
                ...(options.runtimeGenerationId !== undefined
                  ? { runtimeGenerationId: options.runtimeGenerationId }
                  : {}),
              });
              if (event.runId) {
                message.runId = event.runId;
              }
              // Spec §7.3: snapshot the model used for this run onto the
              // assistant transcript message so default-mode walkthrough
              // generation can recover the historical model later.
              const modelSnapshot = options.resolveModel?.();
              if (modelSnapshot) {
                message.model = modelSnapshot;
              }
              const currentDocument = document;
              if (!currentDocument) {
                throw new Error('transcript document was not initialized');
              }
              // Lifecycle events can be replayed across SDK subscription
              // recovery. One message id must map to exactly one transcript row.
              const existingRow = currentDocument.messages.find(
                (item) => item.id === event.messageId,
              );
              if (!existingRow) {
                currentDocument.messages.push(message);
                documentRevision += 1;
                lastAssistantId = event.messageId;
                if (event.runId) {
                  assistantIdsByRunId.set(event.runId, event.messageId);
                }
              } else {
                // ADR 0040 §7: replay is accepted only when the normalized
                // product id AND generation provenance both match. A naked id
                // collision with different (or missing) provenance is a
                // bounded diagnostic and never mutates the older row.
                const recorderGeneration = options.runtimeGenerationId;
                const storedGeneration = existingRow.runtimeGenerationId;
                if (
                  recorderGeneration !== undefined &&
                  storedGeneration !== undefined &&
                  storedGeneration !== recorderGeneration
                ) {
                  quarantinedMessageIds.add(event.messageId);
                  lastAssistantId = null;
                  if (event.runId) {
                    assistantIdsByRunId.delete(event.runId);
                    quarantinedRunIds.add(event.runId);
                  }
                  options.onDiagnostic?.(
                    `message/start collision: messageId=${event.messageId} ` +
                      `storedGeneration=${storedGeneration} currentGeneration=${recorderGeneration}`,
                  );
                } else if (recorderGeneration !== undefined && storedGeneration === undefined) {
                  quarantinedMessageIds.add(event.messageId);
                  lastAssistantId = null;
                  if (event.runId) {
                    assistantIdsByRunId.delete(event.runId);
                    quarantinedRunIds.add(event.runId);
                  }
                  options.onDiagnostic?.(
                    `message/start collision with legacy row: messageId=${event.messageId} ` +
                      `currentGeneration=${recorderGeneration}`,
                  );
                } else {
                  lastAssistantId = event.messageId;
                  if (event.runId) {
                    assistantIdsByRunId.set(event.runId, event.messageId);
                  }
                }
              }
              await persistDocument();
            }
            break;
          }
          case 'message/text_delta': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            const eventAt = new Date().toISOString();
            updateMessage(
              event.messageId,
              (message) => ({
                ...(event.delta.length > 0
                  ? finishTranscriptThinking(message, eventAt)
                  : message),
                text: message.text + event.delta,
                status: 'streaming',
              }),
              `text_delta runId=${event.runId ?? 'none'} deltaLen=${event.delta.length}`,
            );
            scheduleFlush();
            break;
          }
          case 'message/text_snapshot': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            const eventAt = new Date().toISOString();
            updateMessage(
              event.messageId,
              (message) => ({
                ...(event.text.length > 0 ? finishTranscriptThinking(message, eventAt) : message),
                text: event.text,
                status: 'streaming',
              }),
              `text_snapshot runId=${event.runId ?? 'none'} textLen=${event.text.length}`,
            );
            scheduleFlush();
            break;
          }
          case 'message/thinking_delta': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            const eventAt = new Date().toISOString();
            updateMessage(
              event.messageId,
              (message) => ({
                ...(event.delta.length > 0 ? startTranscriptThinking(message, eventAt) : message),
                thinking: (message.thinking ?? '') + event.delta,
              }),
              `thinking_delta runId=${event.runId ?? 'none'} deltaLen=${event.delta.length}`,
            );
            scheduleFlush();
            break;
          }
          case 'message/search_evidence': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            updateMessage(
              event.messageId,
              (message) => ({
                ...message,
                searchEvidence: mergeSearchEvidence(message.searchEvidence, event.evidence),
              }),
              'message/search_evidence',
            );
            await persistDocument();
            break;
          }
          case 'message/end': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            const eventAt = new Date().toISOString();
            updateMessage(
              event.messageId,
              (message) => ({ ...finishTranscriptThinking(message, eventAt), status: 'done' }),
              `message_end runId=${event.runId ?? 'none'}`,
            );
            const currentDocument = document;
            const messageIndex =
              currentDocument?.messages.findIndex((message) => message.id === event.messageId) ??
              -1;
            const completedMessage =
              messageIndex >= 0 ? currentDocument?.messages[messageIndex] : undefined;
            // The Pi SDK may emit empty assistant lifecycle entries while
            // scheduling internal work. Keep actual thinking/tool activity,
            // but do not persist a visible assistant turn with no content.
            if (
              completedMessage?.role === 'assistant' &&
              completedMessage.text.trim().length === 0 &&
              (completedMessage.thinking ?? '').trim().length === 0 &&
              (completedMessage.tools?.length ?? 0) === 0 &&
              (completedMessage.searchEvidence?.citations.length ?? 0) === 0
            ) {
              currentDocument?.messages.splice(messageIndex, 1);
              documentRevision += 1;
            }
            await persistDocument();
            break;
          }
          case 'tool/start': {
            if (event.runId && quarantinedRunIds.has(event.runId)) break;
            if (
              event.responseMessageId !== undefined &&
              quarantinedMessageIds.has(event.responseMessageId)
            ) {
              break;
            }
            const assistantId =
              event.responseMessageId ??
              (event.runId ? assistantIdsByRunId.get(event.runId) : lastAssistantId);
            if (!assistantId) {
              options.onDiagnostic?.(
                `tool/start dropped (no assistant target): runId=${event.runId ?? 'none'} ` +
                  `tool=${event.toolName} lastAssistantId=${lastAssistantId ?? 'none'}`,
              );
              break;
            }
            const eventAt = new Date().toISOString();
            updateMessage(assistantId, (message) => ({
              ...finishTranscriptThinking(message, eventAt),
              tools: appendToolCard(message.tools, {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: 'running',
                output: '',
                ...(event.runId ? { runId: event.runId } : {}),
                ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
                ...(event.presentation ? { presentation: event.presentation } : {}),
              }),
            }));
            await persistDocument();
            break;
          }
          case 'tool/update': {
            if (event.runId && quarantinedRunIds.has(event.runId)) break;
            if (
              event.responseMessageId !== undefined &&
              quarantinedMessageIds.has(event.responseMessageId)
            ) {
              break;
            }
            const assistantId =
              event.responseMessageId ??
              (event.runId ? assistantIdsByRunId.get(event.runId) : lastAssistantId);
            if (!assistantId) {
              options.onDiagnostic?.(
                `tool/update dropped (no assistant target): runId=${event.runId ?? 'none'} ` +
                  `toolCallId=${event.toolCallId} lastAssistantId=${lastAssistantId ?? 'none'}`,
              );
              break;
            }
            updateMessage(assistantId, (message) => ({
              ...message,
              tools: (message.tools ?? []).map((tool) =>
                tool.toolCallId === event.toolCallId &&
                (event.runId === undefined ||
                  tool.runId === undefined ||
                  tool.runId === event.runId)
                  ? {
                      ...tool,
                      output:
                        event.presentation?.output?.text ??
                        appendBoundedToolOutput(tool.output, event.delta, maxToolOutputBytes),
                      ...(event.presentation
                        ? { presentation: { ...tool.presentation, ...event.presentation } }
                        : {}),
                      ...(event.responseMessageId
                        ? { responseMessageId: event.responseMessageId }
                        : {}),
                    }
                  : tool,
              ),
            }));
            break;
          }
          case 'tool/end': {
            if (event.runId && quarantinedRunIds.has(event.runId)) break;
            if (
              event.responseMessageId !== undefined &&
              quarantinedMessageIds.has(event.responseMessageId)
            ) {
              break;
            }
            const assistantId =
              event.responseMessageId ??
              (event.runId ? assistantIdsByRunId.get(event.runId) : lastAssistantId);
            if (!assistantId) {
              options.onDiagnostic?.(
                `tool/end dropped (no assistant target): runId=${event.runId ?? 'none'} ` +
                  `toolCallId=${event.toolCallId} lastAssistantId=${lastAssistantId ?? 'none'}`,
              );
              break;
            }
            updateMessage(assistantId, (message) => {
              const attachments = event.isError
                ? message.attachments
                : appendGeneratedMediaAttachments(message.attachments, event.attachments);
              return {
                ...message,
                ...(attachments ? { attachments } : {}),
                tools: (message.tools ?? []).map((tool) => {
                  if (
                    tool.toolCallId !== event.toolCallId ||
                    (event.runId !== undefined &&
                      tool.runId !== undefined &&
                      tool.runId !== event.runId)
                  ) {
                    return tool;
                  }
                  const mergedPresentation = event.presentation
                    ? { ...tool.presentation, ...event.presentation }
                    : tool.presentation;
                  // Prefer final presentation output (Pi custom tools often only
                  // emit tool/end with AgentToolResult content, no tool/update).
                  const finalOutput =
                    mergedPresentation?.output?.text !== undefined &&
                    mergedPresentation.output.text.length > 0
                      ? mergedPresentation.output.text
                      : tool.output;
                  return {
                    ...tool,
                    status: event.isError ? ('error' as const) : ('done' as const),
                    output: finalOutput,
                    ...(event.responseMessageId
                      ? { responseMessageId: event.responseMessageId }
                      : {}),
                    ...(mergedPresentation ? { presentation: mergedPresentation } : {}),
                  };
                }),
              };
            });
            await persistDocument();
            break;
          }
          case 'session/aborted': {
            const assistantId =
              event.messageId ??
              (event.runId !== undefined ? assistantIdsByRunId.get(event.runId) : lastAssistantId);
            if (
              assistantId !== undefined &&
              assistantId !== null &&
              !quarantinedMessageIds.has(assistantId)
            ) {
              const eventAt = new Date().toISOString();
              updateMessage(assistantId, (message) => ({
                ...finishTranscriptThinking(message, eventAt),
                status: message.status === 'streaming' ? 'done' : message.status,
              }));
              await persistDocument();
            }
            break;
          }
          case 'error': {
            if (lastAssistantId) {
              const eventAt = new Date().toISOString();
              updateMessage(lastAssistantId, (message) => ({
                ...finishTranscriptThinking(message, eventAt),
                status: 'error',
              }));
              await persistDocument();
            }
            break;
          }
          default:
            break;
        }
      });
    },

    async flush() {
      if (disposed) {
        return;
      }
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

    dispose() {
      disposed = true;
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      backgroundFlushError = null;
      document = null;
      // Drop the write queue so in-flight ops that still resolve cannot
      // persist after dispose (enqueueWrite no-ops when disposed).
      writeQueue = Promise.resolve();
    },
  };
}

function startTranscriptThinking(
  message: SessionTranscriptMessage,
  startedAt: string,
): SessionTranscriptMessage {
  if (message.thinkingStartedAt !== undefined) return message;
  return { ...message, thinkingStartedAt: startedAt };
}

function finishTranscriptThinking(
  message: SessionTranscriptMessage,
  endedAt: string,
): SessionTranscriptMessage {
  if (message.thinkingStartedAt === undefined || message.thinkingEndedAt !== undefined) {
    return message;
  }
  return { ...message, thinkingEndedAt: endedAt };
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

function appendGeneratedMediaAttachments(
  existing: MediaAttachmentRef[] | undefined,
  additions: readonly MediaAttachmentRef[] | undefined,
): MediaAttachmentRef[] | undefined {
  if (!additions || additions.length === 0) {
    return existing;
  }
  const existingIds = new Set((existing ?? []).map((attachment) => attachment.id));
  const merged = [...(existing ?? [])];
  for (const attachment of additions) {
    if (!existingIds.has(attachment.id)) {
      existingIds.add(attachment.id);
      merged.push(attachment);
    }
  }
  return merged;
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
