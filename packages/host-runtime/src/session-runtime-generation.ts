/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import type { CreateSessionInput, ExecutionRunRecord } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

import { getSessionRecord } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { type RuntimeReplacementCandidate } from './session-runtime-replacement.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

/**
 * Rebuild the resident generation for a cross-Provider model switch.
 * Provider registration is frozen into each compiled generation, so a
 * prompt must never try to teach the old Pi ModelRuntime a new provider.
 */
export async function replaceRuntimeForModel(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<void> {
  const status = deps.runtimeController.getStatus(sessionId);
  if (status.generationId === undefined) {
    // Cold activation compiles directly from the latest session model; no
    // replacement transaction is needed.
    return;
  }
  const targetSettingsRevision = status.desiredSettingsRevision ?? status.settingsRevision;
  if (targetSettingsRevision === undefined) {
    throw new Error(`runtime model switch has no Settings revision: ${sessionId}`);
  }
  await deps.runtimeReplacementEngine.replace({
    sessionId,
    reason: 'model-change',
    targetSettingsRevision,
    expectedActiveGenerationId: status.generationId,
    // The current prompt is deliberately not attached to the old
    // generation; descendants still correlated to it are drained first.
    when: 'after-current-run',
  });
}

export async function compileRuntimeCandidate(
  deps: HostRuntimeKernel,
  sessionId: string,
  generationId: string,
  expectedSettingsRevision: string,
): Promise<RuntimeReplacementCandidate> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
  if (!record) throw new Error(`Unknown session: ${sessionId}`);
  const input: CreateSessionInput = { projectPath: record.projectPath };
  if (record.scope !== undefined) input.scope = record.scope;
  if (record.workingDirectory !== undefined) input.cwd = record.workingDirectory;
  if (record.name !== undefined) input.sessionName = record.name;
  if (record.presentation) input.presentation = record.presentation;
  const model = deps.sessionModels.get(sessionId);
  if (model !== undefined) input.model = model;
  const prepared = await deps.host.prepareSession(sessionId, input, generationId);
  deps.preparedRuntimeGenerations.set(`${sessionId}\u0000${generationId}`, prepared);
  if (prepared.settingsRevision !== expectedSettingsRevision) {
    throw new Error('runtime-reload-revision-mismatch');
  }
  const deploymentId = deps.extensionDeploymentIdsBySession.get(sessionId);
  if (deploymentId !== undefined && prepared.extensionSetRevision !== undefined) {
    deps.runtimeController.setExtensionDeploymentTarget(
      sessionId,
      prepared.extensionSetRevision,
      deploymentId,
    );
  }
  return {
    generationId,
    settingsRevision: prepared.settingsRevision,
    ...(prepared.extensionSetRevision !== undefined
      ? { extensionSetRevision: prepared.extensionSetRevision }
      : {}),
  };
}

export async function disposeRuntimeGeneration(
  deps: HostRuntimeKernel,
  sessionId: string,
  generationId: string,
): Promise<void> {
  const key = `${sessionId}\u0000${generationId}`;
  const cleanupErrors: unknown[] = [];
  const retiredSession = deps.retiredRuntimeSessions.get(key);
  if (retiredSession) {
    try {
      await retiredSession.abort();
    } catch (error) {
      cleanupErrors.push(error);
    }
    deps.retiredRuntimeSessions.delete(key);
  }
  try {
    await deps.host.releaseSessionGeneration(sessionId, generationId);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await deps.mcpManager?.releaseGenerationSnapshot(
      deps.generationMcpSnapshots.get(key)?.generationId ?? key,
    );
  } catch (error) {
    cleanupErrors.push(error);
  }
  deps.sessionHostToolPort?.discardRetiredGeneration(sessionId, generationId);
  deps.clearGenerationToolSurface(sessionId, generationId);
  for (const error of cleanupErrors) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `retired runtime generation cleanup failed for ${sessionId}/${generationId}: ${formatError(error)}`,
    });
  }
}

export async function createRuntimeGeneration(
  deps: HostRuntimeKernel,
  sessionId: string,
  candidate: RuntimeReplacementCandidate,
): Promise<void> {
  const key = `${sessionId}\u0000${candidate.generationId}`;
  const prepared = deps.preparedRuntimeGenerations.get(key);
  if (!prepared) {
    throw new Error(`runtime-reload-candidate-not-prepared: ${key}`);
  }
  const previousSession = deps.sessions.get(sessionId);
  const oldGenerationId = deps.runtimeController.getStatus(sessionId).generationId;
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
  if (!record) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  let promoted = false;
  try {
    if (
      deps.sessionHostToolPort &&
      !deps.sessionHostToolPort.commitPendingGeneration(sessionId, candidate.generationId)
    ) {
      throw new Error(`runtime-reload-pending-surface-missing: ${key}`);
    }
    promoted = deps.sessionHostToolPort !== null;
    const session = deps.host.commitPreparedSession(prepared);
    if (previousSession && oldGenerationId) {
      deps.retiredRuntimeSessions.set(`${sessionId}\u0000${oldGenerationId}`, previousSession);
    }
    await deps.bindSession(
      session,
      record.projectPath,
      record.name,
      undefined,
      candidate.generationId,
    );
    // Settings replacement compiles outside a foreground run.
    deps.sessionRuntimeDelegationModes.set(sessionId, 'auto');
    // A replacement backend has no native Pi conversation state. Its first
    // prompt must reconstruct bounded context from the durable product
    // transcript exactly once, just like a cold activation.
    deps.coldStartHistoryBySession.set(sessionId, candidate.generationId);
    deps.preparedRuntimeGenerations.delete(key);
  } catch (error) {
    if (promoted) {
      deps.sessionHostToolPort?.rollbackCommittedGeneration(sessionId, candidate.generationId);
    }
    deps.preparedRuntimeGenerations.delete(key);
    try {
      await deps.host.abortPreparedSession(prepared);
    } catch (cleanupError) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `candidate backend cleanup failed: ${formatError(cleanupError)}`,
      });
    }
    if (previousSession && oldGenerationId) {
      deps.host.restoreSession(sessionId, previousSession);
      deps.sessions.set(sessionId, previousSession);
      deps.retiredRuntimeSessions.delete(`${sessionId}\u0000${oldGenerationId}`);
      try {
        await deps.bindSession(
          previousSession,
          record.projectPath,
          record.name,
          undefined,
          oldGenerationId,
        );
      } catch (restoreError) {
        deps.push({
          type: 'host/log',
          level: 'error',
          message: `stable session binding restore failed: ${formatError(restoreError)}`,
        });
      }
    }
    throw error;
  }
}

export async function rollbackRuntimeGeneration(
  deps: HostRuntimeKernel,
  sessionId: string,
  generationId: string,
): Promise<void> {
  const key = `${sessionId}\u0000${generationId}`;
  if (deps.coldStartHistoryBySession.get(sessionId) === generationId) {
    deps.coldStartHistoryBySession.delete(sessionId);
  }
  const prefix = `${sessionId}\u0000`;
  const currentGenerationId = deps.runtimeController.getStatus(sessionId).generationId;
  let oldGenerationId =
    currentGenerationId && currentGenerationId !== generationId ? currentGenerationId : undefined;
  let oldSession = oldGenerationId
    ? deps.retiredRuntimeSessions.get(`${prefix}${oldGenerationId}`)
    : undefined;
  if (!oldSession) {
    const retired = [...deps.retiredRuntimeSessions.entries()].find(
      ([retiredKey]) =>
        retiredKey.startsWith(prefix) && retiredKey.slice(prefix.length) !== generationId,
    );
    if (retired) {
      oldGenerationId = retired[0].slice(prefix.length);
      oldSession = retired[1];
    }
  }
  const cleanupErrors: unknown[] = [];
  const candidateSession = deps.sessions.get(sessionId);
  if (candidateSession && candidateSession !== oldSession) {
    try {
      await candidateSession.abort();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  deps.sessionHostToolPort?.rollbackCommittedGeneration(sessionId, generationId);
  try {
    await deps.host.releaseSessionGeneration(sessionId, generationId);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await deps.mcpManager?.releaseGenerationSnapshot(
      deps.generationMcpSnapshots.get(key)?.generationId ?? key,
    );
  } catch (error) {
    cleanupErrors.push(error);
  }
  deps.clearGenerationToolSurface(sessionId, generationId);

  if (oldSession && oldGenerationId) {
    deps.host.restoreSession(sessionId, oldSession);
    deps.sessions.set(sessionId, oldSession);
    deps.retiredRuntimeSessions.delete(`${sessionId}\u0000${oldGenerationId}`);
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
    if (record) {
      try {
        await deps.bindSession(
          oldSession,
          record.projectPath,
          record.name,
          undefined,
          oldGenerationId,
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  for (const error of cleanupErrors) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `runtime generation rollback cleanup failed for ${sessionId}/${generationId}: ${formatError(error)}`,
    });
  }
}

export async function abortRuntimeGeneration(
  deps: HostRuntimeKernel,
  sessionId: string,
  generationId: string,
): Promise<void> {
  const key = `${sessionId}\u0000${generationId}`;
  if (deps.coldStartHistoryBySession.get(sessionId) === generationId) {
    deps.coldStartHistoryBySession.delete(sessionId);
  }
  deps.sessionHostToolPort?.abortPendingGeneration(sessionId, generationId);
  const prepared = deps.preparedRuntimeGenerations.get(key);
  deps.preparedRuntimeGenerations.delete(key);
  const cleanupErrors: unknown[] = [];
  if (prepared) {
    try {
      await deps.host.abortPreparedSession(prepared);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await deps.mcpManager?.releaseGenerationSnapshot(
      deps.generationMcpSnapshots.get(key)?.generationId ?? key,
    );
  } catch (error) {
    cleanupErrors.push(error);
  }
  deps.clearGenerationToolSurface(sessionId, generationId);
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `runtime generation cleanup failed for ${sessionId}/${generationId}`,
    );
  }
}

export function createAdmittedForegroundRun(
  deps: HostRuntimeKernel,
  sessionId: string,
  resumeCheckpointId?: string,
  replaceRunId?: string,
  options?: { deferRuntimeGeneration?: boolean },
): ExecutionRunRecord {
  const runtimeStatus = deps.runtimeController.getStatus(sessionId);
  const updatePending =
    deps.runtimeReplacementEngine.hasPending(sessionId) ||
    runtimeStatus.desiredSettingsRevision !== undefined;
  const generationId =
    updatePending || options?.deferRuntimeGeneration ? undefined : runtimeStatus.generationId;
  const parentRunId = deps.runExecutionContext.getStore();
  const run =
    replaceRunId === undefined
      ? deps.runRegistry.createForegroundRun(
          sessionId,
          generationId,
          resumeCheckpointId,
          parentRunId,
        )
      : deps.runRegistry.replaceForegroundRun(
          sessionId,
          replaceRunId,
          generationId,
          resumeCheckpointId,
          parentRunId,
        );
  if (generationId !== undefined) {
    deps.residencyController.markBusy(sessionId, generationId);
  }
  return run;
}
