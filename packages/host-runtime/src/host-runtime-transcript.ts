/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import type {
  MediaAttachmentRef,
  PromptInput,
  BackendRunInterventionEvent,
  BackendRunInterventionEventResult,
} from '@piwin/contracts';
import {
  assertSessionBodyAvailable,
  formatError,
  isRunTerminal,
  USER_AUTHORED_GENERATION,
} from '@piwin/contracts';
import { createModelPromptAssembly } from './model-context-assembly.js';
import { isExplicitAppleHealthTurn } from './health-turn-display.js';
import { persistAndPushAssembly } from './model-context-record.js';

import {
  getSessionRecord,
  openModelContextStore,
  type SessionTranscriptStore,
} from '@piwin/session';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { createStoreTranscriptRecorder } from './store-transcript-recorder.js';
import { transcriptAppendPush } from './transcript-append-push.js';
import {
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionModelContextDatabasePath,
} from './paths.js';
import { ok } from './response-helpers.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export async function ensureTranscriptRecorder(
  deps: HostRuntimeKernel,
  sessionId: string,
  projectPath: string,
  runtimeGenerationId: string,
): Promise<void> {
  if (deps.transcriptRecorders.has(sessionId)) {
    return;
  }
  const store = await deps.transcriptStores.get(sessionId, projectPath);
  deps.transcriptRecorders.set(
    sessionId,
    createStoreTranscriptRecorder({
      store,
      runtimeGenerationId,
      resolveModel: () => deps.sessionModels.get(sessionId),
      onDiagnostic: (message) =>
        deps.push({ type: 'host/log', level: 'warn', message: `[transcript] ${message}` }),
    }),
  );
}

export async function handleBackendRunInterventionEvent(
  deps: HostRuntimeKernel,
  sessionId: string,
  event: BackendRunInterventionEvent,
): Promise<BackendRunInterventionEventResult> {
  const activeRun = deps.runRegistry.getForegroundRun(sessionId);
  if (
    activeRun?.runId !== event.runId ||
    activeRun.runtimeGenerationId !== event.runtimeGenerationId ||
    isRunTerminal(activeRun.status)
  ) {
    return { accepted: false };
  }
  const store = await deps.getTranscriptStore(sessionId);
  const existing = await store.getRunIntervention(event.interventionId);
  if (
    existing === undefined ||
    existing.runId !== event.runId ||
    existing.runtimeGenerationId !== event.runtimeGenerationId
  ) {
    return { accepted: false };
  }
  if (event.type === 'claim') {
    if (activeRun.status === 'cancelling' || activeRun.phase === 'pausing') {
      // Admission closes before Stop/Pause settles. An already-observed
      // `applied` marker may still finalize below, but no new claim may
      // cross the control boundary once shutdown has begun.
      return { accepted: false };
    }
    const applying = await store.transitionRunIntervention({
      interventionId: event.interventionId,
      expectedRevision: event.revision,
      from: ['pending'],
      to: 'applying',
      updatedAt: new Date().toISOString(),
    });
    if (applying === undefined) return { accepted: false };
    deps.push({ type: 'run/intervention-updated', intervention: applying });
    return { accepted: true };
  }
  if (event.type === 'applied') {
    const appliedAt = new Date().toISOString();
    const requestOrdinal = await deps.nextModelRequestOrdinal(sessionId);
    const applied = await store.transitionRunIntervention({
      interventionId: event.interventionId,
      expectedRevision: event.revision,
      from: ['applying'],
      to: 'applied',
      updatedAt: appliedAt,
      appliedAt,
      appliedRequestOrdinal: requestOrdinal,
    });
    if (applied === undefined) return { accepted: false };
    const assembly = createModelPromptAssembly();
    assembly.add({
      kind: 'user',
      label: 'Run intervention',
      trustOrigin: 'user',
      text: applied.input.text,
    });
    await persistAndPushAssembly({
      ...(deps.options.piwinRoot === undefined ? {} : { piwinRoot: deps.options.piwinRoot }),
      summary: assembly.toSummary({
        sessionId,
        runId: applied.runId,
        requestClass: 'run-intervention',
        requestOrdinal,
        userMessageId: applied.userMessageId,
      }),
      push: (message) => deps.push(message),
    });
    deps.push({ type: 'run/intervention-updated', intervention: applied });
    return { accepted: true };
  }
  const current = await store.getRunIntervention(event.interventionId);
  if (current === undefined || current.revision !== event.revision) {
    // Late lifecycle events from an edited/cancelled staging revision must
    // never terminalize the newer durable instruction.
    return { accepted: false };
  }
  const applying = current.status === 'applying';
  const terminal = await store.transitionRunIntervention({
    interventionId: current.interventionId,
    expectedRevision: current.revision,
    from: [current.status],
    to: applying ? 'uncertain' : event.type === 'expired' ? 'expired' : 'failed',
    updatedAt: new Date().toISOString(),
    terminalReason: applying
      ? 'application-outcome-unknown'
      : event.type === 'expired'
        ? 'run-ended'
        : 'backend-rejected',
  });
  if (terminal === undefined) return { accepted: false };
  deps.push({ type: 'run/intervention-updated', intervention: terminal });
  return { accepted: true };
}

export async function recordUserPrompt(
  deps: HostRuntimeKernel,
  sessionId: string,
  input: PromptInput,
): Promise<void> {
  const projectPath = deps.sessionProjects.get(sessionId) ?? 'unknown';
  const runtimeGenerationId = deps.runtimeController.getStatus(sessionId).generationId;
  const clientMessageId = input.clientMessageId?.trim();
  const userId =
    clientMessageId && clientMessageId.length > 0
      ? clientMessageId
      : `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const attachments = input.attachments?.filter(
    (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
  );
  if (runtimeGenerationId === undefined) {
    // A cold prompt is durably accepted before runtime admission. User rows
    // own Host provenance and therefore do not require a Pi generation.
    const result = await deps.withTranscriptStore(
      sessionId,
      (store) =>
        store.appendMessage({
          id: userId,
          runtimeGenerationId: USER_AUTHORED_GENERATION,
          backendMessageId: userId,
          role: 'user',
          text: input.text,
          status: 'done',
          createdAt,
          ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
          ...(input.source === 'voice-delegation'
            ? {
                metadata: {
                  promptSource: 'voice-delegation' as const,
                  ...(input.voiceCallId ? { voiceCallId: input.voiceCallId } : {}),
                },
              }
            : {}),
        }),
      projectPath,
    );
    if (!result.ok) {
      throw new Error(`Cold prompt transcript identity collision: ${userId}`);
    }
  } else {
    await deps.ensureTranscriptRecorder(sessionId, projectPath, runtimeGenerationId);
    const recorder = deps.transcriptRecorders.get(sessionId);
    if (recorder) {
      await recorder.recordUserPrompt({ ...input, clientMessageId: userId });
    }
  }
  const message: SessionTranscriptMessage = {
    id: userId,
    role: 'user',
    text: input.text,
    status: 'done',
    createdAt,
    runtimeGenerationId: USER_AUTHORED_GENERATION,
    ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    ...(input.contextRefs !== undefined && input.contextRefs.length > 0
      ? { contextRefs: input.contextRefs.map((ref) => ({ ...ref })) }
      : {}),
    ...(input.source === 'voice-delegation'
      ? {
          source: 'voice-delegation' as const,
          ...(input.voiceCallId ? { voiceCallId: input.voiceCallId } : {}),
        }
      : {}),
  };
  deps.healthTurnBySession.set(sessionId, {
    explicit: isExplicitAppleHealthTurn(input.contextRefs),
  });
  deps.push(transcriptAppendPush(sessionId, message));
  // Await text naming so name-updated is ordered with the user turn and the
  // session becomes listable before the model stream starts.
  try {
    await deps.maybeAssignTextNameFromPrompt(sessionId, input.text);
  } catch (error: unknown) {
    const detail = formatError(error);
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `interim session name failed: ${detail}`,
    });
  }
}

export async function nextModelRequestOrdinal(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<number> {
  const previous = deps.modelRequestOrdinalTails.get(sessionId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  deps.modelRequestOrdinalTails.set(sessionId, tail);
  await previous;

  try {
    let lastOrdinal = deps.modelRequestOrdinals.get(sessionId);
    if (lastOrdinal === undefined) {
      const rootDir = getPiwinRoot(deps.options.piwinRoot);
      const store = await openModelContextStore({
        dbPath: getPiwinSessionModelContextDatabasePath(rootDir, sessionId),
        sessionId,
      });
      try {
        const events = await store.listEvents();
        lastOrdinal = events.reduce(
          (maximum, event) => Math.max(maximum, event.requestOrdinal ?? 0),
          0,
        );
      } finally {
        store.close();
      }
      deps.modelRequestOrdinals.set(sessionId, lastOrdinal);
    }
    const next = lastOrdinal + 1;
    deps.modelRequestOrdinals.set(sessionId, next);
    return next;
  } catch (error) {
    // A visibility ledger failure must not prevent the provider request.
    // persistAndPushAssembly reports the capture failure separately.
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `model request ordinal load failed: ${formatError(error)}`,
    });
    const next = (deps.modelRequestOrdinals.get(sessionId) ?? 0) + 1;
    deps.modelRequestOrdinals.set(sessionId, next);
    return next;
  } finally {
    release?.();
    if (deps.modelRequestOrdinalTails.get(sessionId) === tail) {
      deps.modelRequestOrdinalTails.delete(sessionId);
    }
  }
}

export async function loadTranscriptMessages(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<SessionTranscriptMessage[]> {
  return deps.withTranscriptStore(sessionId, (store) => store.listTail(100));
}

/**
 * Central body-availability choke point. Offloaded / missing-pack stubs must
 * never open or create transcript.sqlite3.
 */
export async function requireAvailableSessionBody(deps: HostRuntimeKernel, sessionId: string) {
  const record = await getSessionRecord(
    getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot)),
    sessionId,
  );
  if (record) {
    assertSessionBodyAvailable(record, 'open-body');
  }
  return record;
}

export async function getTranscriptStore(
  deps: HostRuntimeKernel,
  sessionId: string,
  projectPathOverride?: string,
): Promise<SessionTranscriptStore> {
  const record = await deps.requireAvailableSessionBody(sessionId);
  const projectPath =
    projectPathOverride ?? deps.sessionProjects.get(sessionId) ?? record?.projectPath;
  if (projectPath === undefined) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return deps.transcriptStores.get(sessionId, projectPath);
}

export async function withTranscriptStore<T>(
  deps: HostRuntimeKernel,
  sessionId: string,
  operation: (store: SessionTranscriptStore) => Promise<T>,
  projectPathOverride?: string,
): Promise<T> {
  const record = await deps.requireAvailableSessionBody(sessionId);
  const projectPath =
    projectPathOverride ?? deps.sessionProjects.get(sessionId) ?? record?.projectPath;
  if (projectPath === undefined) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return deps.transcriptStores.withStore(
    sessionId,
    projectPath,
    operation,
    (candidateSessionId) =>
      deps.sessions.has(candidateSessionId) || deps.transcriptRecorders.has(candidateSessionId),
  );
}

/**
 * Drop run-correlation state after truncate/dispose so a rebuilt shell does
 * not inherit stale ownership from an aborted live handle.
 */
export function resetSessionEventState(deps: HostRuntimeKernel, sessionId: string): void {
  deps.runEventCorrelator.clear(sessionId);
}
