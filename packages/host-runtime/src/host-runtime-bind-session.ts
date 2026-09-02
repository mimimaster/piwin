/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';
import type { AgentEvent, SessionHandle } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

import { registerSessionRuntimeLease } from './session-runtime-lease.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { persistDurableSessionRecord } from './durable-session-record.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import type { SessionLineage } from './host-runtime-types.js';
import { routeSessionAgentEvent } from './session-agent-event-router.js';

export async function bindSession(
  deps: HostRuntimeKernel,
  session: SessionHandle,
  projectPath?: string,
  sessionName?: string,
  lineage?: SessionLineage,
  bindingGenerationId?: string,
): Promise<void> {
  const bindingRuntimeGenerationId =
    bindingGenerationId ?? deps.runtimeController.getStatus(session.id).generationId;
  if (
    bindingRuntimeGenerationId !== undefined &&
    deps.residencyController.getResidency(session.id) === 'cold'
  ) {
    throw new Error(
      `runtime-residency-invariant: ${session.id}/${bindingRuntimeGenerationId} was created before admission`,
    );
  }
  const existing = deps.unsubscribers.get(session.id);
  if (existing) {
    existing();
  }
  deps.sessions.set(session.id, session);
  if (!deps.sessionRuntimeDelegationModes.has(session.id)) {
    // Direct creates and settings replacements compile outside a foreground
    // run, so their model-facing delegation surface is normal auto mode.
    deps.sessionRuntimeDelegationModes.set(session.id, 'auto');
  }
  // projectPath may be '' for General sessions — still bind maps + index.
  if (projectPath !== undefined) {
    deps.sessionProjects.set(session.id, projectPath);
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    try {
      await persistDurableSessionRecord({
        rootDir,
        indexPath,
        sessionId: session.id,
        projectPath,
        ...(sessionName ? { sessionName } : {}),
        ...(lineage ? { lineage } : {}),
      });
    } catch (error) {
      const detail = formatError(error);
      const warning = `session index write failed: ${detail}`;
      console.warn(warning);
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: warning,
      });
      // Keep the live session usable when the optional index projection is
      // temporarily unavailable. The transcript store and runtime lease are
      // still established below; the warning makes the durability gap
      // explicit and a later index write can repair the projection.
    }
  }

  const boundRuntimeGenerationId = bindingRuntimeGenerationId;
  await deps.ensureTranscriptRecorder(
    session.id,
    projectPath ?? deps.sessionProjects.get(session.id) ?? 'unknown',
    boundRuntimeGenerationId ?? `host-untracked-${randomUUID()}`,
  );

  // Capture parent session id for subagent event forwarding (inline stream UX).
  const parentSessionId = lineage?.parentSessionId;

  const unsubscribeAgent = session.subscribe((event: AgentEvent) => {
    routeSessionAgentEvent(
      deps,
      session,
      event,
      boundRuntimeGenerationId,
      parentSessionId,
      projectPath,
    );
  });
  const unsubscribeInterventions = session.subscribeRunInterventions?.((event) =>
    deps.handleBackendRunInterventionEvent(session.id, event),
  );
  deps.unsubscribers.set(session.id, () => {
    unsubscribeAgent();
    unsubscribeInterventions?.();
  });

  const pendingDirectGeneration = deps.pendingDirectActivations.get(session.id);
  if (
    pendingDirectGeneration !== undefined &&
    pendingDirectGeneration === boundRuntimeGenerationId
  ) {
    deps.pendingDirectActivations.delete(session.id);
    deps.residencyController.commitActivation(session.id, pendingDirectGeneration);
  }
  const leaseStartedAt = deps.runtimeLeaseStartedAt.get(session.id) ?? new Date().toISOString();
  deps.runtimeLeaseStartedAt.set(session.id, leaseStartedAt);
  await registerSessionRuntimeLease({
    rootDir: getPiwinRoot(deps.options.piwinRoot),
    sessionId: session.id,
    owner: {
      ownerId: deps.runtimeLeaseOwnerId,
      pid: process.pid,
      startedAt: leaseStartedAt,
    },
  });

  // Apply the resolved setting before activation returns. A prompt can be
  // accepted immediately after bind; fire-and-forget here let Pi inspect its
  // default first and made SDK/RPC auto-compaction timing nondeterministic.
  // Settings persistence is still best-effort during bind: a transient
  // setter failure must not turn an otherwise durable session create into a
  // false failure. The warning keeps the policy drift observable.
  try {
    await deps.applyAutoCompactionToSession(session);
  } catch (error) {
    const message = formatError(error);
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `auto-compaction apply failed: ${message}`,
    });
  }
}
