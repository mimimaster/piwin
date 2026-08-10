import type {
  AgentEvent,
  MediaAttachmentRef,
  ModelRef,
  PromptInput,
  SessionToolCardView,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { mergeSearchEvidence, USER_AUTHORED_GENERATION } from '@piwin/contracts';
import type { SessionTranscriptStore, TranscriptStoreMessagePatch } from '@piwin/session';
import { appendToolCard } from '@piwin/session';
import type { TranscriptRecorder } from './transcript-recorder.js';

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_TOOL_OUTPUT_BYTES = 256 * 1024;
const TOOL_OUTPUT_TRUNCATION_MARKER = '\n[output truncated: retention limit reached]';

/**
 * SQLite-backed recorder that retains only active assistant rows. Completed
 * history remains in SessionTranscriptStore and is never reconstructed into a
 * process-wide transcript document.
 */
export function createStoreTranscriptRecorder(options: {
  store: SessionTranscriptStore;
  runtimeGenerationId: string;
  flushIntervalMs?: number;
  maxToolOutputBytes?: number;
  onError?: (error: unknown) => void;
  onDiagnostic?: (message: string) => void;
  resolveModel?: () => ModelRef | undefined;
}): TranscriptRecorder {
  const activeMessages = new Map<string, SessionTranscriptMessage>();
  const dirtyMessageIds = new Set<string>();
  const assistantIdsByRunId = new Map<string, string>();
  const quarantinedMessageIds = new Set<string>();
  const quarantinedRunIds = new Set<string>();
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxToolOutputBytes = validateToolOutputLimit(
    options.maxToolOutputBytes ?? DEFAULT_MAX_TOOL_OUTPUT_BYTES,
  );
  let lastAssistantId: string | null = null;
  let writeQueue: Promise<void> = Promise.resolve();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let backgroundFlushError: unknown = null;
  let disposed = false;

  function enqueue(operation: () => Promise<void>): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }
    const queued = writeQueue.then(operation, operation);
    writeQueue = queued.catch(() => undefined);
    return queued;
  }

  async function loadActive(messageId: string): Promise<SessionTranscriptMessage | undefined> {
    const active = activeMessages.get(messageId);
    if (active !== undefined) {
      return active;
    }
    const persisted = await options.store.getMessage(messageId);
    if (persisted !== undefined && persisted.status === 'streaming') {
      activeMessages.set(messageId, persisted);
      return persisted;
    }
    return undefined;
  }

  async function mutateActive(
    messageId: string,
    update: (message: SessionTranscriptMessage) => SessionTranscriptMessage,
    droppedContext: string,
  ): Promise<SessionTranscriptMessage | undefined> {
    const message = await loadActive(messageId);
    if (message === undefined) {
      options.onDiagnostic?.(
        `transcript delta dropped (${droppedContext}): messageId=${messageId} activeRows=${activeMessages.size}`,
      );
      return undefined;
    }
    const next = update(message);
    activeMessages.set(messageId, next);
    dirtyMessageIds.add(messageId);
    return next;
  }

  async function flushDirty(): Promise<void> {
    const messageIds = [...dirtyMessageIds];
    for (const messageId of messageIds) {
      const message = activeMessages.get(messageId);
      if (message === undefined) {
        dirtyMessageIds.delete(messageId);
        continue;
      }
      const updated = await options.store.updateMessage(messageId, messagePatch(message));
      if (!updated) {
        options.onDiagnostic?.(`transcript row disappeared before flush: messageId=${messageId}`);
      }
      dirtyMessageIds.delete(messageId);
    }
  }

  function scheduleFlush(): void {
    if (disposed || flushTimer !== undefined) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void enqueue(flushDirty).catch((error: unknown) => {
        backgroundFlushError = error;
        options.onError?.(error);
      });
    }, flushIntervalMs);
    flushTimer.unref?.();
  }

  async function flushNow(): Promise<void> {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    await flushDirty();
  }

  function assistantTarget(
    event: Extract<AgentEvent, { type: 'tool/start' | 'tool/update' | 'tool/end' }>,
  ): string | undefined {
    if (event.runId !== undefined && quarantinedRunIds.has(event.runId)) {
      return undefined;
    }
    return event.runId === undefined
      ? (lastAssistantId ?? undefined)
      : assistantIdsByRunId.get(event.runId);
  }

  return {
    async recordUserPrompt(input) {
      const clientMessageId = input.clientMessageId?.trim();
      const userId =
        clientMessageId && clientMessageId.length > 0
          ? clientMessageId
          : `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const attachments = input.attachments?.filter(
        (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
      );
      const result = await options.store.appendMessage({
        id: userId,
        runtimeGenerationId: USER_AUTHORED_GENERATION,
        backendMessageId: userId,
        role: 'user',
        text: input.text,
        status: 'done',
        createdAt: new Date().toISOString(),
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      });
      if (!result.ok) {
        options.onDiagnostic?.(`user transcript identity collision: messageId=${userId}`);
      }
    },

    async recordEvent(event) {
      await enqueue(async () => {
        switch (event.type) {
          case 'message/start': {
            if (event.role !== 'assistant') {
              break;
            }
            const model = options.resolveModel?.();
            const message: SessionTranscriptMessage = {
              id: event.messageId,
              role: 'assistant',
              text: '',
              thinking: '',
              tools: [],
              status: 'streaming',
              createdAt: new Date().toISOString(),
              runtimeGenerationId: options.runtimeGenerationId,
              ...(event.runId !== undefined ? { runId: event.runId } : {}),
              ...(model !== undefined ? { model } : {}),
            };
            const result = await options.store.appendMessage({
              id: message.id,
              runtimeGenerationId: options.runtimeGenerationId,
              backendMessageId: event.backendMessageId ?? event.messageId,
              role: message.role,
              text: message.text,
              thinking: message.thinking ?? '',
              status: message.status,
              createdAt: message.createdAt,
              ...(message.runId !== undefined ? { runId: message.runId } : {}),
              ...(message.model !== undefined ? { model: message.model } : {}),
              tools: [],
            });
            if (!result.ok) {
              quarantinedMessageIds.add(event.messageId);
              if (event.runId !== undefined) {
                quarantinedRunIds.add(event.runId);
                assistantIdsByRunId.delete(event.runId);
              }
              lastAssistantId = null;
              options.onDiagnostic?.(
                `message/start identity collision: messageId=${event.messageId} generation=${options.runtimeGenerationId}`,
              );
              break;
            }
            const persisted = result.replayed
              ? await options.store.getMessage(event.messageId)
              : message;
            if (persisted !== undefined) {
              activeMessages.set(event.messageId, persisted);
            }
            lastAssistantId = event.messageId;
            if (event.runId !== undefined) {
              assistantIdsByRunId.set(event.runId, event.messageId);
            }
            break;
          }
          case 'message/text_delta': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            await mutateActive(
              event.messageId,
              (message) => ({ ...message, text: message.text + event.delta, status: 'streaming' }),
              `text_delta runId=${event.runId ?? 'none'}`,
            );
            scheduleFlush();
            break;
          }
          case 'message/text_snapshot': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            await mutateActive(
              event.messageId,
              (message) => ({ ...message, text: event.text, status: 'streaming' }),
              `text_snapshot runId=${event.runId ?? 'none'}`,
            );
            scheduleFlush();
            break;
          }
          case 'message/thinking_delta': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            await mutateActive(
              event.messageId,
              (message) => ({ ...message, thinking: (message.thinking ?? '') + event.delta }),
              `thinking_delta runId=${event.runId ?? 'none'}`,
            );
            scheduleFlush();
            break;
          }
          case 'message/search_evidence': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            await mutateActive(
              event.messageId,
              (message) => ({
                ...message,
                searchEvidence: mergeSearchEvidence(message.searchEvidence, event.evidence),
              }),
              'message/search_evidence',
            );
            await flushNow();
            break;
          }
          case 'message/end': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            const completed = await mutateActive(
              event.messageId,
              (message) => ({ ...message, status: 'done' }),
              `message_end runId=${event.runId ?? 'none'}`,
            );
            if (completed === undefined) break;
            if (
              completed.text.trim().length === 0 &&
              (completed.thinking ?? '').trim().length === 0 &&
              (completed.tools?.length ?? 0) === 0 &&
              (completed.searchEvidence?.citations.length ?? 0) === 0
            ) {
              dirtyMessageIds.delete(event.messageId);
              await options.store.deleteMessage(event.messageId);
            } else {
              await flushNow();
            }
            activeMessages.delete(event.messageId);
            if (event.runId !== undefined) assistantIdsByRunId.delete(event.runId);
            if (lastAssistantId === event.messageId) lastAssistantId = null;
            break;
          }
          case 'tool/start': {
            const assistantId = assistantTarget(event);
            if (assistantId === undefined) {
              options.onDiagnostic?.(`tool/start dropped: toolCallId=${event.toolCallId}`);
              break;
            }
            await mutateActive(
              assistantId,
              (message) => ({
                ...message,
                tools: appendToolCard(message.tools, {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  status: 'running',
                  output: '',
                  ...(event.runId !== undefined ? { runId: event.runId } : {}),
                  ...(event.presentation !== undefined ? { presentation: event.presentation } : {}),
                }),
              }),
              'tool/start',
            );
            await flushNow();
            break;
          }
          case 'tool/update': {
            const assistantId = assistantTarget(event);
            if (assistantId === undefined) break;
            await mutateActive(
              assistantId,
              (message) => ({
                ...message,
                tools: (message.tools ?? []).map((tool) =>
                  tool.toolCallId === event.toolCallId
                    ? {
                        ...tool,
                        output:
                          event.presentation?.output?.text ??
                          appendBoundedToolOutput(tool.output, event.delta, maxToolOutputBytes),
                        ...(event.presentation !== undefined
                          ? { presentation: { ...tool.presentation, ...event.presentation } }
                          : {}),
                      }
                    : tool,
                ),
              }),
              'tool/update',
            );
            scheduleFlush();
            break;
          }
          case 'tool/end': {
            const assistantId = assistantTarget(event);
            if (assistantId === undefined) break;
            await mutateActive(
              assistantId,
              (message) => {
                const attachments = event.isError
                  ? message.attachments
                  : appendGeneratedMediaAttachments(message.attachments, event.attachments);
                return {
                  ...message,
                  ...(attachments !== undefined ? { attachments } : {}),
                  tools: (message.tools ?? []).map((tool) =>
                    finalizeTool(tool, event, maxToolOutputBytes),
                  ),
                };
              },
              'tool/end',
            );
            await flushNow();
            break;
          }
          case 'error': {
            if (lastAssistantId !== null) {
              await mutateActive(
                lastAssistantId,
                (message) => ({ ...message, status: 'error' }),
                'error',
              );
              await flushNow();
            }
            break;
          }
          default:
            break;
        }
      });
    },

    async flush() {
      if (disposed) return;
      if (backgroundFlushError !== null) {
        const error = backgroundFlushError;
        backgroundFlushError = null;
        throw error;
      }
      await enqueue(flushNow);
      await writeQueue;
    },

    dispose() {
      disposed = true;
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      activeMessages.clear();
      dirtyMessageIds.clear();
      assistantIdsByRunId.clear();
      quarantinedMessageIds.clear();
      quarantinedRunIds.clear();
      writeQueue = Promise.resolve();
      backgroundFlushError = null;
    },
  };
}

function messagePatch(message: SessionTranscriptMessage): TranscriptStoreMessagePatch {
  return {
    text: message.text,
    status: message.status,
    thinking: message.thinking ?? '',
    tools: message.tools ?? [],
    attachments: message.attachments ?? [],
    metadata: {
      ...(message.phaseHistory !== undefined ? { phaseHistory: message.phaseHistory } : {}),
      ...(message.startedAt !== undefined ? { startedAt: message.startedAt } : {}),
      ...(message.endedAt !== undefined ? { endedAt: message.endedAt } : {}),
      ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
      ...(message.terminalMessage !== undefined
        ? { terminalMessage: message.terminalMessage }
        : {}),
      ...(message.subagentActivity !== undefined
        ? { subagentActivity: message.subagentActivity }
        : {}),
    },
  };
}

function finalizeTool(
  tool: SessionToolCardView,
  event: Extract<AgentEvent, { type: 'tool/end' }>,
  maxToolOutputBytes: number,
): SessionToolCardView {
  if (tool.toolCallId !== event.toolCallId) {
    return tool;
  }
  const presentation =
    event.presentation === undefined
      ? tool.presentation
      : { ...tool.presentation, ...event.presentation };
  const output = presentation?.output?.text ?? tool.output;
  return {
    ...tool,
    status: event.isError ? 'error' : 'done',
    output: truncateUtf8(output, maxToolOutputBytes),
    ...(presentation !== undefined ? { presentation } : {}),
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

function appendBoundedToolOutput(existing: string, delta: string, maximumBytes: number): string {
  if (existing.endsWith(TOOL_OUTPUT_TRUNCATION_MARKER)) {
    return existing;
  }
  return truncateUtf8(`${existing}${delta}`, maximumBytes);
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) {
    return value;
  }
  const markerBytes = Buffer.byteLength(TOOL_OUTPUT_TRUNCATION_MARKER, 'utf8');
  const prefix = Buffer.from(value, 'utf8')
    .subarray(0, maximumBytes - markerBytes)
    .toString('utf8');
  return `${prefix}${TOOL_OUTPUT_TRUNCATION_MARKER}`;
}

function appendGeneratedMediaAttachments(
  existing: MediaAttachmentRef[] | undefined,
  additions: readonly MediaAttachmentRef[] | undefined,
): MediaAttachmentRef[] | undefined {
  if (additions === undefined || additions.length === 0) {
    return existing;
  }
  const merged = [...(existing ?? [])];
  const paths = new Set(merged.map((attachment) => attachment.path));
  for (const attachment of additions) {
    if (!paths.has(attachment.path)) {
      merged.push(attachment);
      paths.add(attachment.path);
    }
  }
  return merged;
}
