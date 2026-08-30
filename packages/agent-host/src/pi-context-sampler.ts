/**
 * Shared SDK/RPC occupancy sampler. Emits context/measurement facts and
 * usage/finalized request measurements. Never attaches raw prompts, images,
 * or tool-result bodies.
 */
import type {
  AgentEvent,
  AssistantUsageMeasurement,
  ContextBoundary,
  ContextMeasurement,
  ContextOccupancy,
} from '@piwin/contracts';
import {
  mapFinalizedAssistantUsage,
  occupancyUsageFromRawMessage,
} from './agent-usage-map.js';
import {
  estimateContextOccupancy,
  estimateTokensFromChars,
  isValidOccupancyBaseline,
  type OccupancyRequestUsage,
  type OccupancyTrailingTokens,
} from './context-occupancy-estimator.js';
import { stampPublishedAgentEvent } from './agent-event-run-id.js';
import {
  normalizeAgentEventIds,
  normalizeGenerationMessageId,
  type GenerationIdentityContext,
} from './generation-identity.js';
import { asRecord, readRole, readString } from './pi-event-read.js';
import { extractToolResultText } from './tool-result-extract.js';
import { readToolCallArgs } from './tool-event-map.js';

export type PiContextUsageSample = {
  tokens: number | null;
  contextWindow: number;
};

/** Model identity used to decide occupancy baseline invalidation (§4.2.8). */
export type OccupancyModelIdentity = {
  providerId: string;
  modelId: string;
  protocol?: string;
};

export function occupancyModelIdentityFromRef(model: {
  providerId: string;
  modelId: string;
  protocol?: string;
}): OccupancyModelIdentity {
  const identity: OccupancyModelIdentity = {
    providerId: model.providerId,
    modelId: model.modelId,
  };
  if (model.protocol !== undefined) {
    identity.protocol = model.protocol;
  }
  return identity;
}

export function sameOccupancyModelIdentity(
  left: OccupancyModelIdentity | undefined,
  right: OccupancyModelIdentity | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  return (
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.protocol === right.protocol
  );
}

export type CreatePiContextSamplerInput = {
  sessionId: string;
  runtimeGenerationId: string;
  getContextUsage?: () => PiContextUsageSample | undefined;
  getRunId?: () => string | undefined;
  signal?: AbortSignal;
  now?: () => Date;
};

export type PiContextSamplerObserveInput = {
  mappedEvents: readonly AgentEvent[];
  raw?: unknown;
  runtimeGenerationId?: string;
};

export type PiContextSampler = {
  observe(input: PiContextSamplerObserveInput): AgentEvent[];
  /** Model change / rebuild: drop the previous measured baseline. */
  invalidateBaseline(): AgentEvent[];
  dispose(): void;
};

export function readPiContextUsageSample(value: unknown): PiContextUsageSample | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const contextWindow = record.contextWindow;
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return undefined;
  }
  const tokens = record.tokens;
  if (tokens !== null && (typeof tokens !== 'number' || !Number.isFinite(tokens))) {
    return undefined;
  }
  return { tokens, contextWindow };
}

export function publishSampledPiSessionEvents(input: {
  mapper: { map: (raw: unknown) => AgentEvent[] };
  sampler: PiContextSampler;
  raw: unknown;
  identity: GenerationIdentityContext;
  runId: string | undefined;
  emit: (event: AgentEvent) => void;
}): void {
  const publishedMapped: AgentEvent[] = [];
  for (const mapped of input.mapper.map(input.raw)) {
    const stamped = stampPublishedAgentEvent(
      normalizeAgentEventIds(mapped, input.identity),
      input.runId,
    );
    if (!stamped) {
      continue;
    }
    publishedMapped.push(stamped);
    input.emit(stamped);
  }
  for (const extra of input.sampler.observe({
    mappedEvents: publishedMapped,
    raw: input.raw,
  })) {
    const stamped = stampPublishedAgentEvent(extra, input.runId);
    if (stamped) {
      input.emit(stamped);
    }
  }
}

export function createPiContextSampler(input: CreatePiContextSamplerInput): PiContextSampler {
  const identity = {
    sessionId: input.sessionId,
    runtimeGenerationId: input.runtimeGenerationId,
  };
  let disposed = false;
  let sampleSequence = 0;
  let cancellationGeneration = 0;
  let baselineInvalidated = false;
  let currentMessageId: string | undefined;
  let evidenceMessageId: string | undefined;
  let streamingText = '';
  let streamingThinking = '';
  let streamingToolArgs = '';
  let trailingUserTokens = 0;
  let trailingToolResultTokens = 0;
  let trailingSteerTokens = 0;
  let trailingUnobserved = false;
  let missingImageEstimate = false;
  let lastCompleted: OccupancyRequestUsage | undefined;
  let blockedRequest: OccupancyRequestUsage | undefined;
  let assistantInFlight = false;
  let compactionBoundary: string | undefined;
  const finalizedIds = new Set<string>();
  const countedToolResults = new Set<string>();

  const nowIso = (): string => (input.now ? input.now() : new Date()).toISOString();

  const dispose = (): void => {
    disposed = true;
  };

  if (input.signal) {
    if (input.signal.aborted) {
      dispose();
    } else {
      input.signal.addEventListener('abort', dispose, { once: true });
    }
  }

  return {
    dispose,
    invalidateBaseline(): AgentEvent[] {
      if (disposed) {
        return [];
      }
      dropBaseline();
      return [emitMeasurement(nowIso())];
    },
    observe(observeInput: PiContextSamplerObserveInput): AgentEvent[] {
      if (disposed) {
        return [];
      }
      if (
        observeInput.runtimeGenerationId !== undefined &&
        observeInput.runtimeGenerationId !== input.runtimeGenerationId
      ) {
        return [];
      }

      const captureGeneration = cancellationGeneration;
      const mapped = observeInput.mappedEvents;
      const raw = asRecord(observeInput.raw);
      let shouldSample = false;
      let compactionStarted = false;
      let compactionEnded = false;

      for (const event of mapped) {
        if (event.type === 'compaction/start') {
          compactionStarted = true;
          cancellationGeneration += 1;
          dropBaseline();
          trailingUserTokens = 0;
          trailingToolResultTokens = 0;
          trailingSteerTokens = 0;
          streamingText = '';
          streamingThinking = '';
          streamingToolArgs = '';
          countedToolResults.clear();
          continue;
        }
        if (event.type === 'compaction/end') {
          compactionEnded = true;
          cancellationGeneration += 1;
          dropBaseline();
          const boundary = readString(raw?.firstKeptEntryId) ?? readString(raw?.compactionBoundary);
          if (boundary) {
            compactionBoundary = boundary;
          }
          shouldSample = true;
          continue;
        }
        if (event.type === 'message/start') {
          currentMessageId = event.messageId;
          if (event.role === 'assistant') {
            assistantInFlight = true;
            streamingText = '';
            streamingThinking = '';
            streamingToolArgs = '';
          }
          continue;
        }
        if (event.type === 'message/text_delta' && event.delta.length > 0) {
          streamingText += event.delta;
          noteEvidence(event.messageId);
          shouldSample = true;
          continue;
        }
        if (event.type === 'message/text_snapshot' && event.text.length > 0) {
          streamingText = event.text;
          noteEvidence(event.messageId);
          shouldSample = true;
          continue;
        }
        if (event.type === 'message/thinking_delta' && event.delta.length > 0) {
          streamingThinking += event.delta;
          noteEvidence(event.messageId);
          shouldSample = true;
          continue;
        }
        if (event.type === 'tool/start') {
          noteEvidence(event.responseMessageId ?? currentMessageId);
          if (assistantInFlight) {
            const argsChars = stringifyChars(readToolCallArgs(raw ?? {}));
            if (argsChars > 0) {
              streamingToolArgs = 'x'.repeat(argsChars);
            }
          }
          shouldSample = true;
          continue;
        }
        if (event.type === 'tool/end') {
          if (!countedToolResults.has(event.toolCallId)) {
            countedToolResults.add(event.toolCallId);
            const output = readString(raw?.output) ?? extractToolResultText(raw?.result) ?? '';
            trailingToolResultTokens += estimateTokensFromChars(output.length);
          }
          shouldSample = true;
          continue;
        }
        if (event.type === 'message/end') {
          currentMessageId = event.messageId;
          const rawMessage = rawMessagePayload(raw);
          const role = readRole(raw?.role) ?? readRole(asRecord(rawMessage)?.role);
          if (role === 'user') {
            trailingUserTokens += estimateTokensFromChars(contentChars(rawMessage).chars);
            const images = contentChars(rawMessage);
            if (images.missingImageEstimate) {
              missingImageEstimate = true;
            }
            shouldSample = true;
          } else if (role === 'assistant' || role === undefined) {
            assistantInFlight = false;
            const usage = occupancyUsageFromRawMessage(rawMessage);
            if (usage) {
              if (isValidOccupancyBaseline(usage)) {
                lastCompleted = usage;
                blockedRequest = undefined;
                baselineInvalidated = false;
                trailingUserTokens = 0;
                trailingToolResultTokens = 0;
                trailingSteerTokens = 0;
                streamingText = '';
                streamingThinking = '';
                streamingToolArgs = '';
                missingImageEstimate = false;
              } else {
                blockedRequest = usage;
              }
            }
            shouldSample = true;
          }
        }
      }

      if (raw?.type === 'model_select') {
        dropBaseline();
        shouldSample = true;
      }

      if (raw?.type === 'message_update' && assistantInFlight) {
        const assistantEvent = asRecord(raw.assistantMessageEvent);
        const toolArgs = readAssistantToolArgUpdate(assistantEvent);
        if (toolArgs) {
          if (toolArgs.kind === 'snapshot') {
            streamingToolArgs = 'x'.repeat(toolArgs.chars);
          } else {
            streamingToolArgs += 'x'.repeat(toolArgs.chars);
          }
          shouldSample = true;
        }
      }

      if (compactionStarted && !compactionEnded) {
        return [];
      }
      if (captureGeneration !== cancellationGeneration && !compactionEnded) {
        return [];
      }

      const extras: AgentEvent[] = [];
      const recordedAt = nowIso();
      extras.push(...finalizeFromMapped(mapped, raw, recordedAt));

      if (!shouldSample) {
        return extras;
      }
      extras.push(emitMeasurement(recordedAt));
      return extras;
    },
  };

  function noteEvidence(messageId: string | undefined): void {
    if (!messageId || evidenceMessageId) {
      return;
    }
    evidenceMessageId = messageId;
    currentMessageId = messageId;
  }

  function finalizeFromMapped(
    mapped: readonly AgentEvent[],
    raw: Record<string, unknown> | null,
    recordedAt: string,
  ): AgentEvent[] {
    const events: AgentEvent[] = [];
    const runId = input.getRunId?.();
    for (const event of mapped) {
      if (event.type !== 'message/end') {
        continue;
      }
      const rawMessage = rawMessagePayload(raw);
      const finalized = mapFinalizedAssistantUsage({
        sessionId: input.sessionId,
        runtimeGenerationId: input.runtimeGenerationId,
        messageId: event.messageId,
        rawMessage,
        recordedAt,
        ...(runId !== undefined ? { runId } : {}),
      });
      pushFinalized(events, finalized);
    }
    if (raw?.type === 'agent_end' && Array.isArray(raw.messages)) {
      for (const message of raw.messages) {
        const record = asRecord(message);
        if (!record || record.role !== 'assistant') {
          continue;
        }
        const backendId =
          readString(record.id) ?? readString(record.messageId) ?? currentMessageId;
        if (!backendId) {
          continue;
        }
        const messageId = backendId.startsWith('piw-m-')
          ? backendId
          : normalizeGenerationMessageId(identity, backendId);
        const finalized = mapFinalizedAssistantUsage({
          sessionId: input.sessionId,
          runtimeGenerationId: input.runtimeGenerationId,
          messageId,
          rawMessage: record,
          recordedAt,
          ...(runId !== undefined ? { runId } : {}),
        });
        pushFinalized(events, finalized);
      }
    }
    return events;
  }

  function pushFinalized(
    events: AgentEvent[],
    measurement: AssistantUsageMeasurement | null,
  ): void {
    if (!measurement || finalizedIds.has(measurement.measurementId)) {
      return;
    }
    finalizedIds.add(measurement.measurementId);
    events.push({ type: 'usage/finalized', measurement });
  }

  function emitMeasurement(sampledAt: string): AgentEvent {
    sampleSequence += 1;
    const occupancy = captureOccupancy(sampledAt);
    const boundary: ContextBoundary = {
      activeLeafMessageId: evidenceMessageId ?? currentMessageId ?? null,
    };
    if (compactionBoundary !== undefined) {
      boundary.compactionBoundary = compactionBoundary;
    }
    const measurement: ContextMeasurement = {
      sessionId: input.sessionId,
      sampleSequence,
      occupancy,
      contextBoundary: boundary,
      sampledAt,
    };
    const runId = input.getRunId?.();
    if (runId !== undefined) measurement.runId = runId;
    measurement.runtimeGenerationId = input.runtimeGenerationId;
    const messageId = evidenceMessageId ?? currentMessageId;
    if (messageId !== undefined) measurement.messageId = messageId;
    return { type: 'context/measurement', measurement };
  }

  function dropBaseline(): void {
    baselineInvalidated = true;
    lastCompleted = undefined;
    blockedRequest = undefined;
    assistantInFlight = false;
  }

  function captureOccupancy(sampledAt: string): ContextOccupancy {
    const piUsage = input.getContextUsage?.();
    const tokensLimit =
      piUsage && piUsage.contextWindow > 0 ? piUsage.contextWindow : undefined;
    if (blockedRequest) {
      return estimateContextOccupancy({
        sampledAt,
        currentRequest: blockedRequest,
        ...(lastCompleted ? { lastCompletedRequest: lastCompleted } : {}),
        ...(tokensLimit !== undefined ? { tokensLimit } : {}),
      });
    }
    if (piUsage && piUsage.tokens === null) {
      return { kind: 'unknown', reason: 'post-compaction' };
    }
    const streamingOutputTokens = estimateTokensFromChars(
      streamingText.length + streamingThinking.length + streamingToolArgs.length,
    );
    const trailing: OccupancyTrailingTokens = {
      userTokens: trailingUserTokens,
      toolResultTokens: trailingToolResultTokens,
      steerTokens: trailingSteerTokens,
      streamingOutputTokens,
    };
    if (trailingUnobserved) trailing.unobserved = true;

    const observedContext = missingImageEstimate
      ? { missingImageEstimate: true as const }
      : undefined;
    const hasTrailing =
      streamingOutputTokens > 0 ||
      trailingUserTokens > 0 ||
      trailingToolResultTokens > 0 ||
      trailingSteerTokens > 0;

    if (isValidOccupancyBaseline(lastCompleted) && lastCompleted && !baselineInvalidated) {
      if (!hasTrailing) {
        return estimateContextOccupancy({
          sampledAt,
          currentRequest: lastCompleted,
          ...(tokensLimit !== undefined ? { tokensLimit } : {}),
          ...(observedContext ? { observedContext } : {}),
        });
      }
      return estimateContextOccupancy({
        sampledAt,
        lastCompletedRequest: lastCompleted,
        trailing,
        ...(tokensLimit !== undefined ? { tokensLimit } : {}),
        ...(observedContext ? { observedContext } : {}),
      });
    }

    if (typeof piUsage?.tokens === 'number') {
      return estimateContextOccupancy({
        sampledAt,
        lastCompletedRequest: { totalTokens: piUsage.tokens, outputTokens: 0 },
        trailing,
        ...(tokensLimit !== undefined ? { tokensLimit } : {}),
        ...(observedContext ? { observedContext } : {}),
      });
    }

    return estimateContextOccupancy({
      sampledAt,
      ...(lastCompleted ? { lastCompletedRequest: lastCompleted } : {}),
      trailing,
      ...(tokensLimit !== undefined ? { tokensLimit } : {}),
      ...(observedContext ? { observedContext } : {}),
      ...(baselineInvalidated ? { baselineInvalidated: true } : {}),
    });
  }
}

function rawMessagePayload(raw: Record<string, unknown> | null): unknown {
  if (!raw) {
    return {};
  }
  return raw.message ?? raw.assistantMessage ?? raw;
}

function contentChars(rawMessage: unknown): { chars: number; missingImageEstimate: boolean } {
  const record = asRecord(rawMessage);
  if (!record) {
    return { chars: 0, missingImageEstimate: false };
  }
  const content = record.content ?? record.text;
  if (typeof content === 'string') {
    return { chars: content.length, missingImageEstimate: false };
  }
  if (!Array.isArray(content)) {
    const text = readString(record.text);
    return { chars: text?.length ?? 0, missingImageEstimate: false };
  }
  let chars = 0;
  let missingImageEstimate = false;
  for (const item of content) {
    const part = asRecord(item);
    if (!part) continue;
    if (part.type === 'text') {
      chars += readString(part.text)?.length ?? 0;
    } else if (part.type === 'image') {
      chars += 4800;
    } else if (part.type === 'image_url' || part.type === 'attachment') {
      missingImageEstimate = true;
    }
  }
  return { chars, missingImageEstimate };
}

function stringifyChars(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === 'string') {
    return value.length;
  }
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function readAssistantToolArgUpdate(
  assistantEvent: Record<string, unknown> | null,
): { kind: 'snapshot' | 'delta'; chars: number } | null {
  if (!assistantEvent) {
    return null;
  }
  const type = readString(assistantEvent.type);
  if (
    type !== 'toolcall_delta' &&
    type !== 'tool_call' &&
    type !== 'tool_call_delta' &&
    type !== 'toolCall'
  ) {
    return null;
  }
  const snapshot = assistantEvent.arguments ?? assistantEvent.args;
  if (snapshot !== undefined && snapshot !== null) {
    const chars = stringifyChars(snapshot);
    return chars > 0 ? { kind: 'snapshot', chars } : null;
  }
  const delta = assistantEvent.delta ?? assistantEvent.partialArgs;
  const chars = stringifyChars(delta);
  return chars > 0 ? { kind: 'delta', chars } : null;
}
