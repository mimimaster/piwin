import type {
  AgentEvent,
  AgentFailure,
  MediaAttachmentRef,
  ModelRef,
  PromptInput,
  SessionToolCardView,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  collectWorkspaceWrites,
  mergeSearchEvidence,
  mergeWorkspaceWrites,
  normalizeAgentFailure,
  USER_AUTHORED_GENERATION,
} from '@piwin/contracts';
import type { SessionTranscriptStore, TranscriptStoreMessagePatch } from '@piwin/session';
import { appendToolCard } from '@piwin/session';
import type { TranscriptRecorder } from './transcript-recorder.js';

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_TOOL_OUTPUT_BYTES = 256 * 1024;
const TOOL_OUTPUT_TRUNCATION_MARKER = '\n[output truncated: retention limit reached]';
/** Bound for the per-message native ordinal counters kept in memory. */
const MAX_NATIVE_ORDINALS_TRACKED = 512;

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
  const pendingEmptyMessageIds = new Set<string>();
  const assistantIdsByRunId = new Map<string, string>();
  const nativeOrdinalsByMessageId = new Map<string, number>();
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

  async function loadActive(
    messageId: string,
    includeCompleted = false,
  ): Promise<SessionTranscriptMessage | undefined> {
    const active = activeMessages.get(messageId);
    if (active !== undefined) {
      return active;
    }
    const persisted = await options.store.getMessage(messageId);
    if (persisted !== undefined && (persisted.status === 'streaming' || includeCompleted)) {
      activeMessages.set(messageId, persisted);
      return persisted;
    }
    return undefined;
  }

  async function mutateActive(
    messageId: string,
    update: (message: SessionTranscriptMessage) => SessionTranscriptMessage,
    droppedContext: string,
    includeCompleted = false,
  ): Promise<SessionTranscriptMessage | undefined> {
    const message = await loadActive(messageId, includeCompleted);
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

  async function prunePendingEmptyMessages(
    messageIds = [...pendingEmptyMessageIds],
  ): Promise<void> {
    for (const messageId of messageIds) {
      if (!pendingEmptyMessageIds.has(messageId)) continue;
      const message = activeMessages.get(messageId) ?? (await options.store.getMessage(messageId));
      // Failed generations must stay visible: the empty bubble is the only
      // durable place TurnErrorCard / resume can attach the provider error.
      const keepFailed =
        message !== undefined &&
        (message.status === 'error' ||
          (message.terminalMessage ?? '').trim().length > 0 ||
          message.outcome === 'failed' ||
          message.failure !== undefined);
      if (
        message !== undefined &&
        !keepFailed &&
        message.text.trim().length === 0 &&
        (message.thinking ?? '').trim().length === 0 &&
        (message.tools?.length ?? 0) === 0 &&
        (message.searchEvidence?.citations.length ?? 0) === 0
      ) {
        dirtyMessageIds.delete(messageId);
        await options.store.deleteMessage(messageId);
        pendingEmptyMessageIds.delete(messageId);
        activeMessages.delete(messageId);
        for (const [runId, assistantId] of assistantIdsByRunId) {
          if (assistantId === messageId) assistantIdsByRunId.delete(runId);
        }
        if (lastAssistantId === messageId) lastAssistantId = null;
        continue;
      }
      pendingEmptyMessageIds.delete(messageId);
      if (!keepFailed) {
        activeMessages.delete(messageId);
      }
    }
  }

  async function persistAssistantFailure(input: {
    messageId: string | null;
    runId?: string;
    errorMessage: string;
    failure?: AgentFailure;
  }): Promise<void> {
    const eventAt = new Date().toISOString();
    const failure = input.failure ?? normalizeAgentFailure(undefined, input.errorMessage);
    const existingId =
      input.messageId ??
      (input.runId !== undefined ? (assistantIdsByRunId.get(input.runId) ?? null) : null) ??
      lastAssistantId;
    if (existingId !== null) {
      pendingEmptyMessageIds.delete(existingId);
      const updated = await mutateActive(
        existingId,
        (message) => ({
          ...finishTranscriptThinking(message, eventAt),
          failure,
        }),
        'error',
        true,
      );
      if (updated !== undefined) {
        await flushNow();
        return;
      }
    }

    // Provider failed before any assistant lifecycle (or the empty row was
    // already pruned). Synthesize a durable error bubble so resume/UI still
    // show the failure instead of a blank transcript.
    const failureId =
      existingId ??
      `piw-m-error-${input.runId ?? Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const model = options.resolveModel?.();
    const message: SessionTranscriptMessage = {
      id: failureId,
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      status: 'streaming',
      createdAt: eventAt,
      failure,
      runtimeGenerationId: options.runtimeGenerationId,
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(model !== undefined ? { model } : {}),
    };
    const result = await options.store.appendMessage({
      id: message.id,
      runtimeGenerationId: options.runtimeGenerationId,
      backendMessageId: message.id,
      role: message.role,
      text: message.text,
      thinking: '',
      status: message.status,
      createdAt: message.createdAt,
      ...(message.runId !== undefined ? { runId: message.runId } : {}),
      ...(message.model !== undefined ? { model: message.model } : {}),
      tools: [],
      metadata: {
        failure,
      },
    });
    if (!result.ok) {
      options.onDiagnostic?.(
        `error transcript identity collision: messageId=${failureId} generation=${options.runtimeGenerationId}`,
      );
      return;
    }
    activeMessages.set(failureId, message);
    lastAssistantId = failureId;
    if (input.runId !== undefined) {
      assistantIdsByRunId.set(input.runId, failureId);
    }
    await flushNow();
  }

  function nextNativeOrdinal(messageId: string): number {
    const next = nativeOrdinalsByMessageId.get(messageId) ?? 0;
    nativeOrdinalsByMessageId.delete(messageId);
    nativeOrdinalsByMessageId.set(messageId, next + 1);
    if (nativeOrdinalsByMessageId.size > MAX_NATIVE_ORDINALS_TRACKED) {
      // Evict the least-recently-used counter. A late entry for an evicted
      // message restarts at 0 and is dropped by the store's unique constraint.
      const oldest = nativeOrdinalsByMessageId.keys().next().value;
      if (oldest !== undefined) {
        nativeOrdinalsByMessageId.delete(oldest);
      }
    }
    return next;
  }

  function assistantTarget(
    event: Extract<AgentEvent, { type: 'tool/start' | 'tool/update' | 'tool/end' }>,
  ): string | undefined {
    if (event.runId !== undefined && quarantinedRunIds.has(event.runId)) {
      return undefined;
    }
    // The adapter can prove the exact Assistant response even after that
    // response has ended. Prefer this stable identity over mutable
    // last-assistant/run maps so tool cards never drift into a later turn.
    if (event.responseMessageId !== undefined) {
      if (quarantinedMessageIds.has(event.responseMessageId)) {
        return undefined;
      }
      return event.responseMessageId;
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
      const contextRefs =
        input.contextRefs && input.contextRefs.length > 0
          ? input.contextRefs.map((ref) => ({ ...ref }))
          : undefined;
      const result = await options.store.appendMessage({
        id: userId,
        runtimeGenerationId: USER_AUTHORED_GENERATION,
        backendMessageId: userId,
        role: 'user',
        text: input.text,
        status: 'done',
        createdAt: new Date().toISOString(),
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
        ...(contextRefs !== undefined ? { contextRefs } : {}),
        ...(input.source === 'voice-delegation'
          ? {
              metadata: {
                promptSource: 'voice-delegation' as const,
                ...(input.voiceCallId ? { voiceCallId: input.voiceCallId } : {}),
              },
            }
          : {}),
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
            const previousAssistantId =
              event.runId !== undefined ? assistantIdsByRunId.get(event.runId) : undefined;
            if (previousAssistantId !== undefined) {
              await prunePendingEmptyMessages([previousAssistantId]);
              activeMessages.delete(previousAssistantId);
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
            const eventAt = new Date().toISOString();
            await mutateActive(
              event.messageId,
              (message) => ({
                ...(event.delta.length > 0
                  ? finishTranscriptThinking(message, eventAt)
                  : message),
                text: message.text + event.delta,
                status: 'streaming',
              }),
              `text_delta runId=${event.runId ?? 'none'}`,
            );
            scheduleFlush();
            break;
          }
          case 'message/text_snapshot': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            const eventAt = new Date().toISOString();
            await mutateActive(
              event.messageId,
              (message) => ({
                ...(event.text.length > 0 ? finishTranscriptThinking(message, eventAt) : message),
                text: event.text,
                status: 'streaming',
              }),
              `text_snapshot runId=${event.runId ?? 'none'}`,
            );
            scheduleFlush();
            break;
          }
          case 'message/thinking_delta': {
            if (quarantinedMessageIds.has(event.messageId)) break;
            const eventAt = new Date().toISOString();
            await mutateActive(
              event.messageId,
              (message) => ({
                ...(event.delta.length > 0 ? startTranscriptThinking(message, eventAt) : message),
                thinking: (message.thinking ?? '') + event.delta,
              }),
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
            const eventAt = new Date().toISOString();
            const completed = await mutateActive(
              event.messageId,
              (message) => ({ ...finishTranscriptThinking(message, eventAt), status: 'done' }),
              `message_end runId=${event.runId ?? 'none'}`,
            );
            if (completed === undefined) break;
            if (
              completed.text.trim().length === 0 &&
              (completed.thinking ?? '').trim().length === 0 &&
              (completed.tools?.length ?? 0) === 0 &&
              (completed.searchEvidence?.citations.length ?? 0) === 0
            ) {
              // Pi ends the Assistant message carrying a tool call before it
              // emits tool_execution_start. Defer empty-row pruning until a
              // later message/flush proves that no tool belongs to this row.
              pendingEmptyMessageIds.add(event.messageId);
            }
            await flushNow();
            activeMessages.delete(event.messageId);
            break;
          }
          case 'message/native_context': {
            // Opaque native copies (spec: session-conversation-tree §4.2).
            // toolResult copies attach to the assistant row that issued the
            // tool call so replay reconstructs provider-valid ordering.
            const targetId =
              event.role === 'assistant'
                ? event.messageId
                : (event.responseMessageId ?? lastAssistantId ?? undefined);
            if (targetId === undefined || quarantinedMessageIds.has(targetId)) {
              options.onDiagnostic?.(
                `native_context dropped: messageId=${event.messageId} role=${event.role}`,
              );
              break;
            }
            const ordinal = nextNativeOrdinal(targetId);
            await options.store.appendNativeEntries(targetId, [{ ordinal, entry: event.entry }]);
            break;
          }
          case 'tool/start': {
            const assistantId = assistantTarget(event);
            if (assistantId === undefined) {
              options.onDiagnostic?.(`tool/start dropped: toolCallId=${event.toolCallId}`);
              break;
            }
            pendingEmptyMessageIds.delete(assistantId);
            const eventAt = new Date().toISOString();
            await mutateActive(
              assistantId,
              (message) => ({
                ...finishTranscriptThinking(message, eventAt),
                tools: appendToolCard(message.tools, {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  status: 'running',
                  output: '',
                  ...(event.runId !== undefined ? { runId: event.runId } : {}),
                  ...(event.responseMessageId !== undefined
                    ? { responseMessageId: event.responseMessageId }
                    : {}),
                  ...(event.presentation !== undefined ? { presentation: event.presentation } : {}),
                }),
              }),
              'tool/start',
              true,
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
                        ...(event.responseMessageId !== undefined
                          ? { responseMessageId: event.responseMessageId }
                          : {}),
                      }
                    : tool,
                ),
              }),
              'tool/update',
              true,
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
                const tools = (message.tools ?? []).map((tool) =>
                  finalizeTool(tool, event, maxToolOutputBytes),
                );
                const ended = tools.find((tool) => tool.toolCallId === event.toolCallId);
                const writes =
                  ended?.presentation === undefined
                    ? null
                    : collectWorkspaceWrites(ended.presentation);
                return {
                  ...message,
                  ...(attachments !== undefined ? { attachments } : {}),
                  tools,
                  ...(writes
                    ? { workspaceWrites: mergeWorkspaceWrites(message.workspaceWrites, writes) }
                    : {}),
                };
              },
              'tool/end',
              true,
            );
            await flushNow();
            activeMessages.delete(assistantId);
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
              await mutateActive(
                assistantId,
                (message) => ({
                  ...finishTranscriptThinking(message, eventAt),
                  status: message.status === 'streaming' ? 'done' : message.status,
                }),
                'session/aborted',
                true,
              );
              await flushNow();
              activeMessages.delete(assistantId);
            }
            break;
          }
          case 'session/ended': {
            await prunePendingEmptyMessages();
            activeMessages.clear();
            assistantIdsByRunId.clear();
            lastAssistantId = null;
            break;
          }
          case 'error': {
            await persistAssistantFailure({
              messageId: null,
              ...(event.runId !== undefined ? { runId: event.runId } : {}),
              errorMessage: event.message.trim() || 'Model request failed',
              ...(event.failure === undefined ? {} : { failure: event.failure }),
            });
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
      await enqueue(async () => {
        await flushNow();
        await prunePendingEmptyMessages();
      });
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
      pendingEmptyMessageIds.clear();
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
      ...(message.thinkingStartedAt !== undefined
        ? { thinkingStartedAt: message.thinkingStartedAt }
        : {}),
      ...(message.thinkingEndedAt !== undefined
        ? { thinkingEndedAt: message.thinkingEndedAt }
        : {}),
      ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
      ...(message.terminalMessage !== undefined
        ? { terminalMessage: message.terminalMessage }
        : {}),
      ...(message.failure !== undefined ? { failure: message.failure } : {}),
      ...(message.subagentActivity !== undefined
        ? { subagentActivity: message.subagentActivity }
        : {}),
      ...(message.searchEvidence !== undefined ? { searchEvidence: message.searchEvidence } : {}),
      ...(message.workspaceWrites !== undefined
        ? { workspaceWrites: message.workspaceWrites }
        : {}),
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
    ...(event.responseMessageId !== undefined
      ? { responseMessageId: event.responseMessageId }
      : {}),
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
