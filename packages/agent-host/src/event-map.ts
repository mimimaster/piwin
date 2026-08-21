import type {
  AgentEvent,
  AgentEventEnvelope,
  AgentMessageRole,
  MediaAttachmentRef,
  ToolPresentation,
} from '@piwin/contracts';
import { mapUsageSnapshot } from './usage-map.js';
import { normalizeNativeSearchCitations } from './native-web-search.js';
import {
  boundToolOutput,
  buildToolPresentation,
  resolvePresentedToolInvocation,
} from './tool-presentation.js';

/**
 * Wrapped event with an envelope for idempotent delivery.
 * The envelope carries a unique eventId and ascending sequence number so the
 * consumer can detect replayed, reordered, or stale events.
 */
export type WrappedAgentEvent = {
  event: AgentEvent;
  envelope: AgentEventEnvelope;
};

/**
 * Creates a sequential envelope generator scoped to an optional runId.
 * Each call to `next()` produces a monotonically increasing sequence number
 * paired with a unique eventId.
 */
export function createEventEnvelopeGenerator(runId?: string): {
  next: (runIdOverride?: string) => AgentEventEnvelope;
} {
  let sequence = 0;
  return {
    next(runIdOverride?: string): AgentEventEnvelope {
      sequence++;
      const envelope: AgentEventEnvelope = {
        eventId: `evt-${Date.now().toString(36)}-${sequence}`,
        sequence,
      };
      const resolvedRunId = runIdOverride ?? runId;
      if (resolvedRunId !== undefined) {
        envelope.runId = resolvedRunId;
      }
      return envelope;
    },
  };
}

/**
 * Wraps a single AgentEvent with the next envelope from a generator.
 */
export function wrapEvent(
  event: AgentEvent,
  envelopeGenerator: ReturnType<typeof createEventEnvelopeGenerator>,
): WrappedAgentEvent {
  return {
    event,
    envelope: envelopeGenerator.next(),
  };
}

/**
 * Wraps an array of AgentEvent objects with sequential envelopes.
 */
export function wrapEvents(
  events: AgentEvent[],
  envelopeGenerator: ReturnType<typeof createEventEnvelopeGenerator>,
): WrappedAgentEvent[] {
  return events.map((event) => ({
    event,
    envelope: envelopeGenerator.next(extractRunId(event)),
  }));
}

/**
 * Extract a runId from an event if it has one, for envelope scoping.
 */
function extractRunId(event: AgentEvent): string | undefined {
  return 'runId' in event ? (event as { runId?: string }).runId : undefined;
}

export type PiSessionEventMapper = {
  map: (raw: unknown) => WrappedAgentEvent[];
  /** Clear bounded per-lifecycle state when a session is aborted, ended, or dropped. */
  reset?: () => void;
};

/**
 * Per-entry cap for serialized native context copies. Oversized messages keep
 * only a truncated marker so huge tool outputs never bloat the RPC pipe or the
 * transcript store; replay falls back to text for those rows.
 */
const MAX_NATIVE_ENTRY_BYTES = 262_144;

/**
 * Serialize the native Pi message carried by a `message_end` event into an
 * opaque context copy (spec: session-conversation-tree §4). Only assistant and
 * toolResult messages are captured; user rows are re-synthesized at replay.
 */
function buildNativeContextEvent(
  record: Record<string, unknown>,
  endedMessageId: string,
  lastAssistantMessageId: string | null,
): AgentEvent | undefined {
  const message = asRecord(record.message);
  if (!message) {
    return undefined;
  }
  const role = message.role;
  if (role !== 'assistant' && role !== 'toolResult') {
    return undefined;
  }
  let payload = '';
  try {
    payload = JSON.stringify(message);
  } catch {
    return undefined;
  }
  const byteLength = Buffer.byteLength(payload, 'utf8');
  const entry =
    byteLength > MAX_NATIVE_ENTRY_BYTES
      ? { format: 'pi-message-v1' as const, payload: '', byteLength, truncated: true as const }
      : { format: 'pi-message-v1' as const, payload, byteLength };
  if (role === 'toolResult') {
    return {
      type: 'message/native_context',
      messageId: endedMessageId,
      role: 'toolResult',
      entry,
      ...(lastAssistantMessageId !== null
        ? { responseMessageId: lastAssistantMessageId }
        : {}),
    };
  }
  return {
    type: 'message/native_context',
    messageId: endedMessageId,
    role: 'assistant',
    entry,
  };
}

type ToolPresentationSeed = {
  effectiveToolName: string;
  routedToolName?: string;
  startPresentation: ToolPresentation;
};

/**
 * Pi can omit message ids on SDK lifecycle events. The mapper must keep the
 * generated id for the whole message lifecycle; a constant fallback such as
 * "unknown" merges separate thinking/tool turns in the renderer.
 *
 * Returned events are wrapped with sequential envelopes for idempotent delivery.
 */
export function createPiSessionEventMapper(): PiSessionEventMapper {
  let activeMessageId: string | null = null;
  let activeMessageRole: AgentMessageRole | null = null;
  let lastAssistantMessageId: string | null = null;
  let generatedMessageSequence = 0;
  const toolNamesById = new Map<string, string>();
  const presentationSeedsByToolId = new Map<string, ToolPresentationSeed>();
  const responseMessageIdsByToolId = new Map<string, string>();
  const rawToolOutputById = new Map<string, string>();
  const citationUrlsByMessageId = new Map<string, Set<string>>();
  /** Dedupe identical upstream provider errors across message_end + agent_end. */
  const surfacedProviderErrorMessages = new Set<string>();
  const envelopeGenerator = createEventEnvelopeGenerator();

  const reset = (): void => {
    activeMessageId = null;
    activeMessageRole = null;
    lastAssistantMessageId = null;
    toolNamesById.clear();
    presentationSeedsByToolId.clear();
    responseMessageIdsByToolId.clear();
    rawToolOutputById.clear();
    citationUrlsByMessageId.clear();
    surfacedProviderErrorMessages.clear();
  };

  return {
    reset,
    map(raw: unknown): WrappedAgentEvent[] {
      if (!raw || typeof raw !== 'object') {
        return [];
      }

      const record = raw as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : '';
      if (type === 'message_start') {
        const explicitMessageId = readString(record.messageId) ?? readNestedId(record, 'message');
        activeMessageId = explicitMessageId ?? `pi-message-${++generatedMessageSequence}`;
        activeMessageRole =
          readRole(record.role) ?? readNestedRole(record, 'message') ?? 'assistant';
      }

      const mappedEvents: AgentEvent[] = mapPiSessionEvent(
        raw,
        activeMessageId,
        lastAssistantMessageId,
        activeMessageRole,
      )
        .flatMap((event) => filterDuplicateSearchEvidence(event, citationUrlsByMessageId))
        .filter((event) => {
          if (event.type !== 'error') {
            return true;
          }
          const key = event.message.trim();
          if (key.length === 0) {
            return true;
          }
          if (surfacedProviderErrorMessages.has(key)) {
            return false;
          }
          surfacedProviderErrorMessages.add(key);
          return true;
        })
        .map((event): AgentEvent => {
          if (event.type === 'tool/start') {
            toolNamesById.set(event.toolCallId, event.toolName);
            const rawEvent = raw as Record<string, unknown>;
            const args = readToolCallArgs(rawEvent);
            const invocation = resolvePresentedToolInvocation(event.toolName, args);
            const startPresentation = buildToolPresentation({
              toolName: invocation.effectiveToolName,
              ...(invocation.effectiveArgs !== undefined ? { args: invocation.effectiveArgs } : {}),
              ...(invocation.routedToolName !== undefined
                ? { routedToolName: invocation.routedToolName }
                : {}),
            });
            presentationSeedsByToolId.set(event.toolCallId, {
              effectiveToolName: invocation.effectiveToolName,
              ...(invocation.routedToolName !== undefined
                ? { routedToolName: invocation.routedToolName }
                : {}),
              startPresentation,
            });
            if (event.responseMessageId !== undefined) {
              responseMessageIdsByToolId.set(event.toolCallId, event.responseMessageId);
            }
            rawToolOutputById.set(event.toolCallId, '');
            return { ...event, presentation: startPresentation };
          }
          if (event.type === 'tool/update') {
            const rawEvent = raw as Record<string, unknown>;
            const rawDelta =
              typeof rawEvent.delta === 'string'
                ? rawEvent.delta
                : typeof rawEvent.output === 'string'
                  ? rawEvent.output
                  : (extractToolResultText(rawEvent.partialResult) ?? event.delta);
            const fullOutput = `${rawToolOutputById.get(event.toolCallId) ?? ''}${rawDelta}`;
            // Keep the cross-chunk redaction buffer bounded. This still preserves
            // enough cumulative context to catch secrets split across chunks,
            // while preventing a long-running tool from growing host memory.
            const boundedOutput = boundToolOutput(fullOutput).text;
            rawToolOutputById.set(event.toolCallId, boundedOutput);
            const toolName = toolNamesById.get(event.toolCallId) ?? 'unknown';
            const seed = presentationSeedsByToolId.get(event.toolCallId);
            const responseMessageId =
              event.responseMessageId ?? responseMessageIdsByToolId.get(event.toolCallId);
            if (responseMessageId !== undefined) {
              responseMessageIdsByToolId.set(event.toolCallId, responseMessageId);
            }
            return {
              ...event,
              presentation: mergeSeededToolPresentation(
                seed?.startPresentation,
                buildToolPresentation({
                  toolName: seed?.effectiveToolName ?? toolName,
                  ...(seed?.routedToolName !== undefined
                    ? { routedToolName: seed.routedToolName }
                    : {}),
                  outputText: boundedOutput,
                }),
              ),
              ...(responseMessageId !== undefined ? { responseMessageId } : {}),
            };
          }
          if (event.type === 'tool/end') {
            const toolName = toolNamesById.get(event.toolCallId) ?? 'unknown';
            const seed = presentationSeedsByToolId.get(event.toolCallId);
            const accumulated = rawToolOutputById.get(event.toolCallId) ?? '';
            const responseMessageId =
              event.responseMessageId ?? responseMessageIdsByToolId.get(event.toolCallId);
            toolNamesById.delete(event.toolCallId);
            presentationSeedsByToolId.delete(event.toolCallId);
            responseMessageIdsByToolId.delete(event.toolCallId);
            rawToolOutputById.delete(event.toolCallId);
            // Pi custom tools often emit only tool_execution_end (no streaming
            // updates). Prefer presentation.output from mapPiSessionEvent; fall
            // back to any accumulated update buffer.
            const existingOutput = event.presentation?.output?.text;
            if (existingOutput && existingOutput.length > 0) {
              return {
                ...event,
                ...(responseMessageId !== undefined ? { responseMessageId } : {}),
                presentation: mergeSeededToolPresentation(
                  seed?.startPresentation,
                  seed
                    ? buildToolPresentation({
                        toolName: seed.effectiveToolName,
                        ...(seed.routedToolName !== undefined
                          ? { routedToolName: seed.routedToolName }
                          : {}),
                        isError: event.isError,
                        outputText: existingOutput,
                        ...(event.presentation?.exitCode !== undefined
                          ? { exitCode: event.presentation.exitCode }
                          : {}),
                      })
                    : event.presentation!,
                ),
              };
            }
            if (accumulated.length > 0) {
              return {
                ...event,
                ...(responseMessageId !== undefined ? { responseMessageId } : {}),
                presentation: mergeSeededToolPresentation(
                  seed?.startPresentation,
                  buildToolPresentation({
                    toolName: seed?.effectiveToolName ?? toolName,
                    ...(seed?.routedToolName !== undefined
                      ? { routedToolName: seed.routedToolName }
                      : {}),
                    isError: event.isError,
                    outputText: accumulated,
                  }),
                ),
              };
            }
            return {
              ...event,
              ...(responseMessageId !== undefined ? { responseMessageId } : {}),
              ...(event.presentation !== undefined
                ? {
                    presentation: mergeSeededToolPresentation(
                      seed?.startPresentation,
                      event.presentation,
                    ),
                  }
                : {}),
            };
          }
          return event;
        });
      if (type === 'agent_end') {
        toolNamesById.clear();
        presentationSeedsByToolId.clear();
        responseMessageIdsByToolId.clear();
        rawToolOutputById.clear();
        surfacedProviderErrorMessages.clear();
      }
      if (type === 'message_end') {
        const endedMessage = mappedEvents.find((event) => event.type === 'message/end');
        const endedMessageRole =
          readRole(record.role) ?? readNestedRole(record, 'message') ?? activeMessageRole;
        if (endedMessage?.type === 'message/end') {
          // Built before lastAssistantMessageId advances so toolResult copies
          // correlate to the assistant message that issued the tool call.
          const nativeEvent = buildNativeContextEvent(
            record,
            endedMessage.messageId,
            lastAssistantMessageId,
          );
          if (nativeEvent !== undefined) {
            mappedEvents.push(nativeEvent);
          }
        }
        if (endedMessage?.type === 'message/end' && endedMessageRole === 'assistant') {
          lastAssistantMessageId = endedMessage.messageId;
          citationUrlsByMessageId.delete(endedMessage.messageId);
        }
        activeMessageId = null;
        activeMessageRole = null;
      }
      return wrapEvents(mappedEvents, envelopeGenerator);
    },
  };
}

function mergeSeededToolPresentation(
  seed: ToolPresentation | undefined,
  lifecycle: ToolPresentation,
): ToolPresentation {
  if (!seed) {
    return lifecycle;
  }
  return {
    ...seed,
    ...lifecycle,
    kind: seed.kind,
    title: seed.title,
    ...(seed.routedToolName !== undefined ? { routedToolName: seed.routedToolName } : {}),
    ...(seed.summary !== undefined ? { summary: seed.summary } : {}),
    ...(seed.inputPreview !== undefined ? { inputPreview: seed.inputPreview } : {}),
    ...(seed.command !== undefined ? { command: seed.command } : {}),
    ...(seed.targetPaths !== undefined ? { targetPaths: seed.targetPaths } : {}),
    ...(seed.changedPaths !== undefined ? { changedPaths: seed.changedPaths } : {}),
  };
}

/**
 * Map Pi SDK / RPC-like session events into normalized AgentEvent[].
 * Defensive: unknown shapes return [] (never throw).
 */
export function mapPiSessionEvent(
  raw: unknown,
  activeMessageId?: string | null,
  lastAssistantMessageId?: string | null,
  activeMessageRole?: AgentMessageRole | null,
): AgentEvent[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const event = raw as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type : '';

  switch (type) {
    case 'message_start': {
      const messageId =
        readString(event.messageId) ??
        readNestedId(event, 'message') ??
        activeMessageId ??
        'unknown';
      const role = readRole(event.role) ?? readNestedRole(event, 'message') ?? 'assistant';
      return [{ type: 'message/start', messageId, role }];
    }
    case 'message_update': {
      const messageId = readString(event.messageId) ?? activeMessageId ?? 'unknown';
      const assistantEvent = asRecord(event.assistantMessageEvent);
      if (!assistantEvent) {
        return [];
      }
      const assistantType = readString(assistantEvent.type);
      const delta = readString(assistantEvent.delta) ?? '';
      const mapped: AgentEvent[] = [];
      if (assistantType === 'text_delta') {
        mapped.push({ type: 'message/text_delta', messageId, delta });
      } else if (assistantType === 'thinking_delta') {
        mapped.push({ type: 'message/thinking_delta', messageId, delta });
      }
      const evidence = normalizeNativeSearchCitations(assistantEvent);
      if (evidence) {
        mapped.push({ type: 'message/search_evidence', messageId, evidence });
      }
      return mapped;
    }
    case 'message_end': {
      const messageId =
        readString(event.messageId) ??
        readNestedId(event, 'message') ??
        activeMessageId ??
        'unknown';
      const messagePayload = event.message ?? event.assistantMessage ?? event;
      const evidence = normalizeNativeSearchCitations(messagePayload);
      const endedMessageRole =
        readRole(event.role) ??
        readNestedRole(event, 'message') ??
        readNestedRole(event, 'assistantMessage') ??
        activeMessageRole;
      const snapshot =
        endedMessageRole === 'assistant'
          ? extractAssistantMessageSnapshot(messagePayload)
          : null;
      const mapped: AgentEvent[] = [];
      if (snapshot !== null) {
        // Some Pi versions put the complete assistant content only on
        // message_end. Reconstruct a normal lifecycle so the Host recorder
        // and clients do not lose the final response.
        mapped.push({ type: 'message/start', messageId, role: 'assistant' });
        if (snapshot.thinking.length > 0) {
          mapped.push({ type: 'message/thinking_delta', messageId, delta: snapshot.thinking });
        }
        if (snapshot.text.length > 0) {
          mapped.push({ type: 'message/text_snapshot', messageId, text: snapshot.text });
        }
      }
      if (evidence) {
        mapped.push({ type: 'message/search_evidence', messageId, evidence });
      }
      mapped.push({ type: 'message/end', messageId });
      // Pi records provider failures as stopReason:'error' on the assistant
      // message instead of a standalone error event. Without this mapping an
      // instant provider 400 ends the run with zero visible output. Also keep
      // aborted-with-detail so upstream abort reasons are not lost.
      if (endedMessageRole === 'assistant') {
        const endedMessage = asRecord(messagePayload);
        const stopReason = endedMessage ? readString(endedMessage.stopReason) : undefined;
        const errorMessage = readUpstreamErrorMessage(endedMessage, event);
        if (stopReason === 'error') {
          mapped.push({
            type: 'error',
            message: errorMessage ?? 'Model request failed',
          });
        } else if (stopReason === 'aborted' && errorMessage) {
          mapped.push({ type: 'error', message: errorMessage });
        }
      }
      return mapped;
    }
    case 'tool_execution_start': {
      const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
      const toolName = readString(event.toolName) ?? readString(event.name) ?? 'unknown';
      const args = readToolCallArgs(event);
      const invocation = resolvePresentedToolInvocation(toolName, args);
      const presentation = buildToolPresentation({
        toolName: invocation.effectiveToolName,
        ...(invocation.effectiveArgs !== undefined ? { args: invocation.effectiveArgs } : {}),
        ...(invocation.routedToolName !== undefined
          ? { routedToolName: invocation.routedToolName }
          : {}),
      });
      const responseMessageId = resolveResponseMessageId(
        event,
        activeMessageId,
        lastAssistantMessageId,
      );
      return [
        {
          type: 'tool/start',
          toolCallId,
          toolName,
          ...(responseMessageId !== undefined ? { responseMessageId } : {}),
          presentation,
        },
      ];
    }
    case 'tool_execution_update': {
      const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
      // Pi streams partialResult as AgentToolResult; older shapes used delta/output strings.
      const rawDelta =
        readString(event.delta) ??
        readString(event.output) ??
        extractToolResultText(event.partialResult) ??
        '';
      const delta = boundToolOutput(rawDelta).text;
      const responseMessageId = resolveResponseMessageId(
        event,
        activeMessageId,
        lastAssistantMessageId,
      );
      return [
        {
          type: 'tool/update',
          toolCallId,
          delta,
          ...(responseMessageId !== undefined ? { responseMessageId } : {}),
        },
      ];
    }
    case 'tool_execution_end': {
      const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
      const result = asRecord(event.result);
      // Pi normally puts this flag on the lifecycle event. Keep compatibility
      // with bridges that retain it on AgentToolResult instead, but let an
      // explicit top-level false remain authoritative.
      const isError =
        typeof event.isError === 'boolean'
          ? event.isError
          : Boolean(event.error ?? result?.isError);
      const toolName = readString(event.toolName) ?? readString(event.name) ?? 'unknown';
      // Pi 0.80: tool_execution_end.result is AgentToolResult
      // ({ content: TextContent[], details }), not a plain string. Custom MCP
      // tools typically only emit end (no tool_execution_update), so we must
      // extract text from result.content or UI shows "No output".
      const outputText =
        readString(event.output) ??
        extractToolResultText(event.result) ??
        readString(event.delta) ??
        undefined;
      const exitCode =
        typeof event.exitCode === 'number'
          ? event.exitCode
          : typeof event.exit_code === 'number'
            ? event.exit_code
            : undefined;
      // Prefer args when Pi includes them on end so image/video keep prompt
      // summaries; Desktop merge also preserves start-time summary as a backstop.
      const args = readToolCallArgs(event);
      const invocation = resolvePresentedToolInvocation(toolName, args);
      const presentation = buildToolPresentation({
        toolName: invocation.effectiveToolName,
        isError,
        ...(invocation.effectiveArgs !== undefined ? { args: invocation.effectiveArgs } : {}),
        ...(invocation.routedToolName !== undefined
          ? { routedToolName: invocation.routedToolName }
          : {}),
        ...(outputText !== undefined ? { outputText } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
      });
      const attachments = extractToolResultAttachments(result?.details ?? event.details);
      const responseMessageId = resolveResponseMessageId(
        event,
        activeMessageId,
        lastAssistantMessageId,
      );
      return [
        {
          type: 'tool/end',
          toolCallId,
          isError,
          ...(responseMessageId !== undefined ? { responseMessageId } : {}),
          ...(attachments ? { attachments } : {}),
          presentation,
        },
      ];
    }
    case 'compaction_start':
      return [{ type: 'compaction/start' }];
    case 'compaction_end': {
      // Pi 0.80: { type, reason, result?: CompactionResult, aborted, willRetry, errorMessage? }
      // CompactionResult: { summary, tokensBefore, estimatedTokensAfter?, firstKeptEntryId }
      return [mapCompactionEndEvent(event)];
    }
    case 'error': {
      const message =
        readUpstreamErrorMessage(event) ??
        readString(event.message) ??
        readString(event.error) ??
        'unknown error';
      return [{ type: 'error', message, retriable: Boolean(event.retriable) }];
    }
    case 'context_usage':
    case 'usage':
    case 'token_usage': {
      const sessionId = readString(event.sessionId) ?? 'unknown';
      const snapshot = mapUsageSnapshot(sessionId, event, 'pi-contextUsage');
      if (!snapshot) {
        return [];
      }
      return [{ type: 'usage/update', sessionId, usage: snapshot }];
    }
    case 'agent_end': {
      // Pi 0.80 puts normalized assistant usage on agent_end.messages[].
      // Keep one usage event per assistant message so retries/tool turns do not
      // collapse cache reads and writes into one lossy snapshot.
      const sessionId = readString(event.sessionId) ?? 'unknown';
      const assistantUsageEvents: AgentEvent[] = [];
      const providerErrorEvents: AgentEvent[] = [];
      if (Array.isArray(event.messages)) {
        for (const message of event.messages) {
          const assistantMessage = asRecord(message);
          if (assistantMessage?.role !== 'assistant') {
            continue;
          }
          const snapshot = mapUsageSnapshot(sessionId, assistantMessage, 'assistant-usage');
          if (snapshot) {
            assistantUsageEvents.push({ type: 'usage/update', sessionId, usage: snapshot });
          }
          // Backup path: some Pi builds only leave stopReason:'error' on the
          // final messages array. Prefer message_end mapping when present; this
          // still recovers upstream text if message_end was empty/skipped.
          const stopReason = readString(assistantMessage.stopReason);
          const errorMessage = readUpstreamErrorMessage(assistantMessage);
          if (stopReason === 'error') {
            providerErrorEvents.push({
              type: 'error',
              message: errorMessage ?? 'Model request failed',
            });
          } else if (stopReason === 'aborted' && errorMessage) {
            providerErrorEvents.push({ type: 'error', message: errorMessage });
          }
        }
      }
      if (assistantUsageEvents.length > 0 || providerErrorEvents.length > 0) {
        return [...assistantUsageEvents, ...providerErrorEvents];
      }
      // Preserve compatibility with Pi adapters that expose a direct usage
      // object on agent_end instead of the messages array.
      const snapshot =
        mapUsageSnapshot(sessionId, event, 'assistant-usage') ??
        mapUsageSnapshot(sessionId, asRecord(event.usage) ?? {}, 'assistant-usage');
      if (!snapshot) {
        return [];
      }
      return [{ type: 'usage/update', sessionId, usage: snapshot }];
    }
    default:
      return [];
  }
}

/**
 * Map Pi compaction_end (+ host-enriched fields) into AgentEvent.
 * Never invents token counts — only maps numbers when present.
 */
export function mapCompactionEndEvent(
  event: Record<string, unknown>,
): Extract<AgentEvent, { type: 'compaction/end' }> {
  const endEvent: Extract<AgentEvent, { type: 'compaction/end' }> = {
    type: 'compaction/end',
  };

  const aborted = event.aborted === true;
  if (typeof event.ok === 'boolean') {
    endEvent.ok = event.ok;
  } else if (typeof event.isError === 'boolean') {
    endEvent.ok = !event.isError;
  } else if (aborted) {
    endEvent.ok = false;
  } else if (event.result !== undefined) {
    endEvent.ok = event.result !== null;
  }

  const msg =
    readString(event.message) ?? readString(event.errorMessage) ?? readString(event.error);
  if (msg) {
    endEvent.message = msg;
  } else if (aborted) {
    endEvent.message = 'Compaction aborted';
  }

  const result = asRecord(event.result);
  if (result) {
    const summary = readString(result.summary);
    if (summary) {
      endEvent.summary = summary;
      if (!endEvent.message) {
        endEvent.message = summary.slice(0, 200);
      }
    }
    const tokensBefore = readNumber(result.tokensBefore) ?? readNumber(event.tokensBefore);
    if (tokensBefore !== undefined) {
      endEvent.tokensBefore = tokensBefore;
    }
    const tokensAfter =
      readNumber(result.estimatedTokensAfter) ??
      readNumber(result.tokensAfter) ??
      readNumber(event.tokensAfter);
    if (tokensAfter !== undefined) {
      endEvent.tokensAfter = tokensAfter;
    }
  } else {
    const tokensBefore = readNumber(event.tokensBefore);
    if (tokensBefore !== undefined) {
      endEvent.tokensBefore = tokensBefore;
    }
    const tokensAfter = readNumber(event.tokensAfter);
    if (tokensAfter !== undefined) {
      endEvent.tokensAfter = tokensAfter;
    }
    const summary = readString(event.summary);
    if (summary) {
      endEvent.summary = summary;
    }
  }

  const durationMs = readNumber(event.durationMs);
  if (durationMs !== undefined) {
    endEvent.durationMs = durationMs;
  }

  return endEvent;
}

function readToolCallArgs(event: Record<string, unknown>): unknown {
  const nested = asRecord(event.toolCall) ?? asRecord(event.tool) ?? asRecord(event.call);
  const details = asRecord(event.details) ?? asRecord(asRecord(event.result)?.details);
  return (
    event.args ??
    event.arguments ??
    event.input ??
    event.parameters ??
    nested?.args ??
    nested?.arguments ??
    nested?.input ??
    nested?.parameters ??
    details?.args ??
    details?.arguments
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Pull a human-readable upstream provider/Pi error string from common shapes:
 * plain strings, `{ errorMessage }`, `{ error: string | { message } }`, etc.
 * Returns undefined when nothing usable is present (caller chooses fallback).
 */
function readUpstreamErrorMessage(...sources: unknown[]): string | undefined {
  for (const source of sources) {
    if (typeof source === 'string') {
      const trimmed = source.trim();
      if (trimmed.length > 0) return trimmed;
      continue;
    }
    const record = asRecord(source);
    if (!record) continue;
    for (const key of ['errorMessage', 'message', 'error', 'detail', 'details'] as const) {
      const value = record[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) return trimmed;
        continue;
      }
      const nested = asRecord(value);
      if (!nested) continue;
      const nestedMessage =
        readString(nested.message) ??
        readString(nested.errorMessage) ??
        readString(nested.error) ??
        readString(nested.detail);
      if (nestedMessage && nestedMessage.trim().length > 0) {
        return nestedMessage.trim();
      }
    }
  }
  return undefined;
}

type AssistantMessageSnapshot = {
  text: string;
  thinking: string;
};

function extractAssistantMessageSnapshot(value: unknown): AssistantMessageSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const content = record.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      const part = asRecord(item);
      if (!part) {
        continue;
      }
      if (part.type === 'text') {
        const text = readString(part.text);
        if (text) textParts.push(text);
      } else if (part.type === 'thinking' || part.type === 'reasoning') {
        const thinking = readString(part.thinking) ?? readString(part.text);
        if (thinking) thinkingParts.push(thinking);
      }
    }
  } else if (typeof content === 'string' && content.length > 0) {
    textParts.push(content);
  }

  const directText = readString(record.text);
  if (directText) textParts.push(directText);
  const directThinking = readString(record.thinking) ?? readString(record.reasoning);
  if (directThinking) thinkingParts.push(directThinking);

  const snapshot = {
    text: textParts.join(''),
    thinking: thinkingParts.join(''),
  } satisfies AssistantMessageSnapshot;
  return snapshot.text.length > 0 || snapshot.thinking.length > 0 ? snapshot : null;
}

/**
 * Extract display/model text from a Pi tool result payload.
 *
 * Pi `tool_execution_end.result` is `AgentToolResult`:
 * `{ content: Array<{ type: 'text', text: string } | ImageContent>, details }`.
 * Also accepts a plain string (legacy / host-normalized shapes).
 */
export function extractToolResultText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.length > 0 ? value : undefined;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const content = record.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      const part = asRecord(item);
      if (!part) {
        continue;
      }
      if (part.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
        parts.push(part.text);
      }
    }
    if (parts.length > 0) {
      return parts.join('\n');
    }
  }
  // Some adapters put the whole payload under `text`.
  const directText = readString(record.text);
  if (directText) {
    return directText;
  }
  return undefined;
}

/**
 * Extract displayable media outputs from a Host tool's structured details.
 * The path is still checked again by the Desktop media URL resolver before it
 * becomes an image source, so arbitrary tool details cannot bypass that gate.
 */
export function extractToolResultAttachments(value: unknown): MediaAttachmentRef[] | undefined {
  const record = asRecord(value);
  const rawAttachments = record?.attachments;
  if (!Array.isArray(rawAttachments)) {
    return undefined;
  }

  const attachments = rawAttachments.filter(isMediaAttachmentRef);
  return attachments.length > 0 ? attachments : undefined;
}

function isMediaAttachmentRef(value: unknown): value is MediaAttachmentRef {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return (
    typeof record.id === 'string' &&
    record.kind === 'media' &&
    typeof record.path === 'string' &&
    typeof record.mimeType === 'string' &&
    typeof record.byteSize === 'number' &&
    Number.isFinite(record.byteSize) &&
    record.byteSize >= 0 &&
    (record.source === 'paste' ||
      record.source === 'drop' ||
      record.source === 'file-picker' ||
      record.source === 'generated')
  );
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readRole(value: unknown): AgentMessageRole | undefined {
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool') {
    return value;
  }
  // Pi names tool-result lifecycle messages `toolResult`. They are transport
  // artifacts, not additional Assistant/model responses.
  if (value === 'toolResult' || value === 'tool_result') {
    return 'tool';
  }
  return undefined;
}

function filterDuplicateSearchEvidence(
  event: AgentEvent,
  citationUrlsByMessageId: Map<string, Set<string>>,
): AgentEvent[] {
  if (event.type !== 'message/search_evidence') {
    return [event];
  }
  const seenUrls = citationUrlsByMessageId.get(event.messageId) ?? new Set<string>();
  const citations = event.evidence.citations.filter((citation) => {
    const key = citation.url.trim().toLowerCase();
    if (key.length === 0 || seenUrls.has(key)) {
      return false;
    }
    seenUrls.add(key);
    return true;
  });
  citationUrlsByMessageId.set(event.messageId, seenUrls);
  if (citations.length === 0) {
    return [];
  }
  return [
    {
      ...event,
      evidence: {
        ...(event.evidence.query !== undefined ? { query: event.evidence.query } : {}),
        provenance: event.evidence.provenance,
        citations,
      },
    },
  ];
}

function readNestedId(event: Record<string, unknown>, key: string): string | undefined {
  const nested = asRecord(event[key]);
  return nested ? readString(nested.id) : undefined;
}

function readNestedRole(event: Record<string, unknown>, key: string): AgentMessageRole | undefined {
  const nested = asRecord(event[key]);
  return nested ? readRole(nested.role) : undefined;
}

function resolveResponseMessageId(
  event: Record<string, unknown>,
  activeMessageId: string | null | undefined,
  lastAssistantMessageId: string | null | undefined,
): string | undefined {
  return (
    readString(event.responseMessageId) ??
    readString(event.messageId) ??
    readString(event.assistantMessageId) ??
    readNestedId(event, 'assistantMessage') ??
    activeMessageId ??
    lastAssistantMessageId ??
    undefined
  );
}
