/**
 * Foreground run terminalization. HostRuntime live-context wiring calls this
 * so job cleanup, transcript finalization, and residency idle stay together.
 */
import type { RunTerminalCode } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { TerminateHostRunOptions } from './commands/session-live-context.js';
import { isRunAbortReason } from './run-abort-reason.js';
import { finalizeRunTranscriptArtifacts } from './transcript-stream-settler.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export function resolveRunTerminalCode(input: {
  cleanupFailed: boolean;
  outcome: 'completed' | 'cancelled' | 'failed' | 'paused';
  code?: RunTerminalCode;
  supersededByNewPrompt: boolean;
}): RunTerminalCode {
  if (input.cleanupFailed) {
    return 'job-cleanup-failed';
  }
  if (input.outcome === 'cancelled') {
    return input.supersededByNewPrompt ? 'superseded-by-new-prompt' : 'cancelled';
  }
  if (input.outcome === 'completed') {
    return 'completed';
  }
  if (input.outcome === 'paused') {
    return 'paused';
  }
  return input.code ?? 'failed';
}

export async function terminateHostRun(
  deps: HostRuntimeKernel,
  sessionId: string,
  runId: string,
  outcome: 'completed' | 'cancelled' | 'failed' | 'paused',
  code?: RunTerminalCode,
  message?: string,
  options?: TerminateHostRunOptions,
): Promise<boolean> {
  const run = deps.runRegistry.get(runId);
  if (
    !run ||
    run.sessionId !== sessionId ||
    (run.status === 'cancelling' && outcome === 'completed')
  ) {
    return false;
  }
  const jobReason =
    outcome === 'completed' ? 'run-completed' : outcome === 'failed' ? 'failed' : 'run-cancelled';
  let cleanupFailed = false;
  if (deps.jobController && options?.skipJobCleanup !== true) {
    try {
      const cleanup = await deps.jobController.stopByRun(runId, jobReason);
      cleanupFailed = cleanup.failedJobIds.length > 0;
    } catch (error) {
      cleanupFailed = true;
      const detail = formatError(error);
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `run job cleanup failed for ${runId}: ${detail}`,
      });
    }
  }
  const effectiveOutcome = cleanupFailed ? 'failed' : outcome;
  const abortReason =
    deps.runRegistry.getAbortReason(runId) ?? deps.runRegistry.getSignal(runId)?.reason;
  const supersededByNewPrompt =
    (isRunAbortReason(abortReason) && abortReason.code === 'superseded-by-new-prompt') ||
    code === 'superseded-by-new-prompt';
  const effectiveCode = resolveRunTerminalCode({
    cleanupFailed,
    outcome,
    supersededByNewPrompt,
    ...(code === undefined ? {} : { code }),
  });
  const effectiveMessage = cleanupFailed ? (message ?? 'job cleanup failed') : message;
  const terminalStatus = effectiveOutcome === 'paused' ? 'interrupted' : effectiveOutcome;
  const checkpointId = run.resumeCheckpointId;
  if (checkpointId !== undefined) {
    try {
      if (effectiveOutcome === 'completed') {
        await deps.withTranscriptStore(sessionId, (store) =>
          store.consumePauseCheckpoint(checkpointId),
        );
      } else if (effectiveOutcome === 'cancelled') {
        await deps.withTranscriptStore(sessionId, (store) =>
          store.clearPauseCheckpoint(checkpointId),
        );
      }
    } catch (error) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `pause checkpoint finalization failed for ${runId}: ${formatError(error)}`,
      });
    }
  }
  const recorder = deps.transcriptRecorders.get(sessionId);
  if (recorder) {
    try {
      await recorder.flush();
    } catch (error) {
      const detail = formatError(error);
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `transcript terminal flush failed: ${detail}`,
      });
    }
  }
  try {
    const finalized = await deps.withTranscriptStore(sessionId, (store) =>
      finalizeRunTranscriptArtifacts(store, {
        runId,
        outcome:
          effectiveOutcome === 'paused'
            ? 'paused'
            : effectiveOutcome === 'completed'
              ? 'completed'
              : effectiveOutcome === 'cancelled'
                ? 'cancelled'
                : 'failed',
        interventionReason:
          effectiveOutcome === 'paused'
            ? 'run-pausing'
            : effectiveOutcome === 'cancelled'
              ? 'run-cancelling'
              : 'run-ended',
        ...(effectiveMessage !== undefined ? { terminalMessage: effectiveMessage } : {}),
        ...(options?.failure === undefined ? {} : { failure: options.failure }),
        ...(options?.agentStopReason === undefined
          ? {}
          : { agentStopReason: options.agentStopReason }),
      }),
    );
    for (const intervention of finalized.expired) {
      deps.push({ type: 'run/intervention-updated', intervention });
    }
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `run transcript finalization failed for ${runId}: ${formatError(error)}`,
    });
  }
  const terminal = deps.runRegistry.terminate(
    runId,
    terminalStatus,
    effectiveCode,
    effectiveMessage,
    {
      ...(options?.agentStopReason === undefined
        ? {}
        : { agentStopReason: options.agentStopReason }),
      ...(options?.failure === undefined ? {} : { failure: options.failure }),
    },
  );
  if (!terminal) return false;
  // ADR 0040 §5/§7: the terminal Run releases busy residency only when
  // no newer admitted foreground run still owns the session.
  const admitted = deps.runRegistry.getForegroundRun(sessionId);
  if (admitted === undefined || admitted.runId === runId) {
    const terminalGenerationId = deps.runtimeController.getStatus(sessionId).generationId;
    if (terminalGenerationId !== undefined) {
      deps.residencyController.markIdle(sessionId, terminalGenerationId);
      void deps.heartbeatRuntimeLease(sessionId).catch(() => undefined);
    }
  }
  // ORCH: drop turn-scoped scheme binding when the run ends.
  deps.runOrchestrationSchemes.delete(runId);
  deps.schemeAdmissionGate.clear(runId);
  deps.runDelegationModes.delete(runId);
  deps.runEventCorrelator.markRunTerminal(sessionId, runId);
  // CE-NAME: auto-name after first completed exchange (fire-and-forget).
  if (outcome === 'completed') {
    void deps.maybeTriggerAutoName(sessionId).catch((error: unknown) => {
      const detail = formatError(error);
      deps.push({ type: 'host/log', level: 'warn', message: `auto-name failed: ${detail}` });
    });
    // Walkthrough is generated on plan completion, not after ordinary runs.
  }
  return true;
}
