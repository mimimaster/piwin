/**
 * Session.subscribe AgentEvent routing. HostRuntime.bindSession calls this
 * so a late/replaced generation cannot reach transcript, usage, hooks, or UI.
 */
import type { AgentEvent } from '@piwin/contracts';
import { formatError, isRunTerminal } from '@piwin/contracts';
import { enrichAgentEventSessionModel } from './agent-event-session-model.js';
import { enrichAgentEventDocumentTargets } from './document-targets.js';
import { shouldSuppressControlledAbortError } from './run-agent-event-policy.js';
import { getPiwinRoot } from './paths.js';
import { formatFilesTouchedBlock, normalizeCompactionFileOps } from './compaction-file-ops.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export function readEventRunId(event: AgentEvent): string | undefined {
  return 'runId' in event && typeof event.runId === 'string' ? event.runId : undefined;
}

export function hasExplicitRunId(event: AgentEvent): boolean {
  return 'runId' in event && typeof event.runId === 'string';
}

export function routeSessionAgentEvent(
  deps: HostRuntimeKernel,
  session: { id: string },
  event: AgentEvent,
  boundRuntimeGenerationId: string | undefined,
  parentSessionId: string | undefined,
  projectPath: string | undefined,
): void {
  const currentRuntimeGenerationId = deps.runtimeController.getStatus(session.id).generationId;
  if (event.type === 'context/measurement' || event.type === 'usage/finalized') {
    routeContextTelemetryEvent(deps, session.id, event, boundRuntimeGenerationId, currentRuntimeGenerationId);
    return;
  }
  if (currentRuntimeGenerationId !== boundRuntimeGenerationId) {
    // A late callback from a disposed generation must not reach transcript,
    // usage, hooks, or UI state after replacement/recovery.
    return;
  }
  const activeRun = deps.runRegistry.getForegroundRun(session.id);
  const correlation = deps.runEventCorrelator.correlate(
    session.id,
    event,
    activeRun?.runId,
    deps.runExecutionContext.getStore(),
  );
  const correlatedEvent = correlation.event;
  if (!correlation.accepted) {
    if (!hasExplicitRunId(event)) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `discarded uncorrelated session event: ${event.type}`,
      });
    }
    return;
  }
  const correlatedRunId = readEventRunId(correlatedEvent);
  const activeRunId = activeRun?.runId;
  const correlatedRun = correlatedRunId ? deps.runRegistry.get(correlatedRunId) : undefined;
  const correlatedRunSignal =
    correlatedRunId === undefined ? undefined : deps.runRegistry.getSignal(correlatedRunId);
  if (
    shouldSuppressControlledAbortError(correlatedEvent, {
      ...(correlatedRunSignal !== undefined ? { signal: correlatedRunSignal } : {}),
      ...(correlatedRun !== undefined ? { runStatus: correlatedRun.status } : {}),
      ...(correlatedRunId !== undefined
        ? { pauseRequested: deps.runRegistry.isPauseRequested(correlatedRunId) }
        : {}),
    })
  ) {
    return;
  }
  if (
    correlatedRunId !== undefined &&
    ((correlatedRun !== undefined && isRunTerminal(correlatedRun.status)) ||
      (activeRunId !== undefined && correlatedRunId !== activeRunId))
  ) {
    // Context-owned events can have no explicit runId. The correlator
    // annotates them, and this second check prevents old async callbacks
    // from reaching push, hooks, usage, or transcript recording.
    return;
  }
  if (correlatedEvent.type === 'message/native_context') {
    // Native context copies are host-internal (spec: session-conversation-tree
    // §4.3): persist through the recorder, never push to clients, hooks,
    // usage, naming, or the pet reducer.
    const nativeRecorder = deps.transcriptRecorders.get(session.id);
    if (nativeRecorder) {
      void nativeRecorder.recordEvent(correlatedEvent).catch((error: unknown) => {
        const message = formatError(error);
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `native context write failed: ${message}`,
        });
      });
    }
    return;
  }
  if (correlatedEvent.type === 'usage/update') {
    // Occupancy/billing use context/measurement and usage/finalized. Compatible
    // usage/update is a finalized projection from the coordinator only.
    return;
  }
  // Attach logical documentTargets for Doc Preview without rewriting
  // targetPaths (actual tool evidence stays intact).
  const projectPathForTargets = deps.sessionProjects.get(session.id) ?? projectPath ?? null;
  let eventForClients = enrichAgentEventSessionModel(
    enrichAgentEventDocumentTargets(correlatedEvent, {
      ...(projectPathForTargets ? { projectPath: projectPathForTargets } : {}),
      piwinRoot: getPiwinRoot(deps.options.piwinRoot),
    }),
    deps.sessionModels.get(session.id),
  );
  if (eventForClients.type === 'compaction/end' && eventForClients.fileOps) {
    const fileOps = normalizeCompactionFileOps(eventForClients.fileOps);
    eventForClients = { ...eventForClients, fileOps };
    deps.sessionFilesTouched.set(session.id, formatFilesTouchedBlock(fileOps));
  }
  deps.push({ type: 'event', sessionId: session.id, event: eventForClients });
  // Forward child session events to parent for inline subagent stream UX.
  if (parentSessionId) {
    deps.push({
      type: 'subagent/stream',
      parentSessionId,
      childSessionId: session.id,
      event: eventForClients,
    });
  }
  void deps.ensurePetStateStore().then((store) => store.reduce(eventForClients));
  const eventRunId = correlatedRunId ?? activeRunId;
  if (eventRunId !== undefined) {
    deps.runRegistry.noteAgentEvent(eventRunId, eventForClients);
  }
  if (eventForClients.type === 'permission/request') {
    deps.push({
      type: 'permission/request',
      sessionId: session.id,
      requestId: eventForClients.requestId,
      action: eventForClients.action,
      detail: eventForClients.detail,
      defaultDecision: eventForClients.defaultDecision,
      ...(eventForClients.runId ? { runId: eventForClients.runId } : {}),
    });
  }
  if (eventForClients.type === 'compaction/start') {
    void deps.sessionContextCoordinator?.noteCompactionStart(session.id).catch((error: unknown) => {
      logCoordinatorFailure(deps, error);
    });
  }
  if (eventForClients.type === 'compaction/end') {
    void deps.sessionContextCoordinator
      ?.noteCompactionEnd(session.id, {
        // An omitted status is not proof that Pi committed a boundary. The
        // mapper normally supplies a boolean, but fail closed for legacy or
        // custom adapters so an unknown end cannot advance context state.
        ok: eventForClients.ok === true,
        ...(typeof eventForClients.tokensAfter === 'number'
          ? { tokensAfter: eventForClients.tokensAfter }
          : {}),
        ...(typeof eventForClients.tokensBefore === 'number'
          ? { tokensBefore: eventForClients.tokensBefore }
          : {}),
      })
      .catch((error: unknown) => {
        logCoordinatorFailure(deps, error);
      });
  }
  noteResponseEvidenceFromEvent(deps, session.id, eventForClients, correlatedRunId ?? activeRunId);
  // CE-NAME: capture the assistant reply from the event stream so
  // auto-naming can give the LLM title generator exchange context.
  if (correlatedEvent.type === 'message/start' && correlatedEvent.role === 'assistant') {
    deps.assistantTextBuffers.set(correlatedEvent.messageId, '');
  } else if (correlatedEvent.type === 'message/text_delta') {
    const buffer = deps.assistantTextBuffers.get(correlatedEvent.messageId);
    if (buffer !== undefined) {
      deps.assistantTextBuffers.set(correlatedEvent.messageId, buffer + correlatedEvent.delta);
    }
  } else if (correlatedEvent.type === 'message/text_snapshot') {
    const buffer = deps.assistantTextBuffers.get(correlatedEvent.messageId);
    if (buffer !== undefined) {
      deps.assistantTextBuffers.set(correlatedEvent.messageId, correlatedEvent.text);
    }
  } else if (correlatedEvent.type === 'message/end') {
    const reply = deps.assistantTextBuffers.get(correlatedEvent.messageId);
    if (reply !== undefined) {
      deps.assistantTextBuffers.delete(correlatedEvent.messageId);
      deps.sessionLastAssistantReply.set(session.id, reply);
    }
  }
  // CE-HOOK: arm matching hooks on normalized AgentEvent (best-effort, never fails turn).
  void deps.dispatchHooksForAgentEvent(session.id, eventForClients).catch((error: unknown) => {
    const message = formatError(error);
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `hook dispatch failed: ${message}`,
    });
  });
  const recorder = deps.transcriptRecorders.get(session.id);
  if (recorder) {
    void recorder.recordEvent(eventForClients).catch((error: unknown) => {
      const message = formatError(error);
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `transcript event write failed: ${message}`,
      });
    });
  }
}

function routeContextTelemetryEvent(
  deps: HostRuntimeKernel,
  sessionId: string,
  event: Extract<AgentEvent, { type: 'context/measurement' | 'usage/finalized' }>,
  boundRuntimeGenerationId: string | undefined,
  currentRuntimeGenerationId: string | undefined,
): void {
  const measurement = event.measurement;
  if (measurement.sessionId !== sessionId) {
    return;
  }
  if (
    measurement.runtimeGenerationId !== undefined &&
    boundRuntimeGenerationId !== undefined &&
    measurement.runtimeGenerationId !== boundRuntimeGenerationId
  ) {
    return;
  }
  if (currentRuntimeGenerationId !== boundRuntimeGenerationId) {
    return;
  }
  const coordinator = deps.sessionContextCoordinator;
  if (coordinator === undefined) {
    return;
  }
  if (event.type === 'context/measurement') {
    void coordinator
      .ingestMeasurement({
        sessionId,
        measurement: event.measurement,
        ...(boundRuntimeGenerationId !== undefined ? { boundGenerationId: boundRuntimeGenerationId } : {}),
      })
      .catch((error: unknown) => {
        logCoordinatorFailure(deps, error);
      });
    return;
  }
  void coordinator
    .ingestFinalized({
      sessionId,
      measurement: event.measurement,
      ...(boundRuntimeGenerationId !== undefined ? { boundGenerationId: boundRuntimeGenerationId } : {}),
    })
    .catch((error: unknown) => {
      logCoordinatorFailure(deps, error);
    });
}

function noteResponseEvidenceFromEvent(
  deps: HostRuntimeKernel,
  sessionId: string,
  event: AgentEvent,
  runId: string | undefined,
): void {
  const coordinator = deps.sessionContextCoordinator;
  if (coordinator === undefined) {
    return;
  }
  let messageId: string | undefined;
  if (event.type === 'message/text_delta' && event.delta.trim().length > 0) {
    messageId = event.messageId;
  } else if (event.type === 'message/thinking_delta' && event.delta.trim().length > 0) {
    messageId = event.messageId;
  } else if (event.type === 'message/text_snapshot' && event.text.trim().length > 0) {
    messageId = event.messageId;
  } else if (event.type === 'tool/start') {
    messageId = event.responseMessageId;
  } else {
    return;
  }
  void coordinator
    .noteResponseEvidence({
      sessionId,
      ...(runId !== undefined ? { runId } : {}),
      ...(messageId !== undefined ? { messageId } : {}),
    })
    .catch((error: unknown) => {
      logCoordinatorFailure(deps, error);
    });
}

function logCoordinatorFailure(deps: HostRuntimeKernel, error: unknown): void {
  deps.push({
    type: 'host/log',
    level: 'warn',
    message: `session context coordinator failed: ${formatError(error)}`,
  });
}
