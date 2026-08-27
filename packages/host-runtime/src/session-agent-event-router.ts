/**
 * Session.subscribe AgentEvent routing. HostRuntime.bindSession calls this
 * so a late/replaced generation cannot reach transcript, usage, hooks, or UI.
 */
import type { AgentEvent } from '@piwin/contracts';
import { formatError, isRunTerminal, shouldAcceptContextUsage } from '@piwin/contracts';
import { enrichAgentEventSessionModel } from './agent-event-session-model.js';
import { enrichAgentEventDocumentTargets } from './document-targets.js';
import { shouldSuppressControlledAbortError } from './run-agent-event-policy.js';
import { getPiwinRoot } from './paths.js';
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
  let correlatedEvent = correlation.event;
  if (!correlation.accepted) {
    if (hasExplicitRunId(event)) {
      // Stale explicit events are dropped at the host boundary. In
      // particular, do not let them reach hooks, usage, or transcript.
      return;
    }
    // Provider HTTP failures (404/401/…) often arrive from Pi stream
    // callbacks that broke AsyncLocalStorage. Reclaim identity-less `error`
    // events onto the live foreground run so upstream text is never dropped.
    if (
      event.type === 'error' &&
      activeRun?.runId !== undefined &&
      (activeRun.status === 'running' ||
        activeRun.status === 'queued' ||
        activeRun.status === 'cancelling')
    ) {
      correlatedEvent = { ...event, runId: activeRun.runId };
    } else {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `discarded uncorrelated session event: ${event.type}`,
      });
      return;
    }
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
  // Attach logical documentTargets for Doc Preview without rewriting
  // targetPaths (actual tool evidence stays intact).
  const projectPathForTargets = deps.sessionProjects.get(session.id) ?? projectPath ?? null;
  const eventForClients = enrichAgentEventSessionModel(
    enrichAgentEventDocumentTargets(correlatedEvent, {
      ...(projectPathForTargets ? { projectPath: projectPathForTargets } : {}),
      piwinRoot: getPiwinRoot(deps.options.piwinRoot),
    }),
    deps.sessionModels.get(session.id),
  );
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
  if (event.type === 'usage/update') {
    const currentUsage = deps.sessionUsage.get(session.id);
    if (!shouldAcceptContextUsage(currentUsage, event.usage)) {
      return;
    }
    deps.sessionUsage.set(session.id, event.usage);
    // CE-OBS: only agent_end (assistant-usage) is a billable per-turn
    // count. pi-contextUsage is cumulative context occupancy — never sum.
    if (event.usage.source !== 'pi-contextUsage') {
      deps.enqueueUsageLedgerWrite(session.id, event.usage);
    }
  }
  if (
    eventForClients.type === 'compaction/end' &&
    eventForClients.ok !== false &&
    typeof eventForClients.tokensAfter === 'number'
  ) {
    const previous = deps.sessionUsage.get(session.id);
    const tokensAfter = eventForClients.tokensAfter;
    deps.sessionUsage.set(session.id, {
      sessionId: session.id,
      ...(previous?.modelId ? { modelId: previous.modelId } : {}),
      tokensUsed: tokensAfter,
      ...(typeof previous?.tokensLimit === 'number' ? { tokensLimit: previous.tokensLimit } : {}),
      totalTokens: tokensAfter,
      ...(typeof previous?.tokensLimit === 'number' && previous.tokensLimit > 0
        ? { contextRatio: tokensAfter / previous.tokensLimit }
        : {}),
      updatedAt: new Date().toISOString(),
      source: 'pi-contextUsage',
    });
  }
  // CE-OBS: if mock/host did not emit usage, estimate after assistant message ends.
  if (correlatedEvent.type === 'message/end') {
    void deps.maybeEmitUsageOnMessageEnd(session.id, correlatedEvent.messageId);
  }
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
