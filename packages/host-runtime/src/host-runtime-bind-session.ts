/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';
import type { AgentEvent, SessionHandle } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

import { createSessionRecord, getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { registerSessionRuntimeLease } from './session-runtime-lease.js';
import { getPiwinGeneralWorkspacePath, getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import type { SessionLineage } from './host-runtime-types.js';
import { routeSessionAgentEvent } from './session-agent-event-router.js';
import { applySubagentLineage, copySubagentLineage } from './session-lineage-apply.js';

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
      const current = await getSessionRecord(indexPath, session.id);
      if (current) {
        current.updatedAt = new Date().toISOString();
        if (sessionName) {
          current.name = sessionName;
        }
        if (lineage?.parentSessionId) {
          current.parentSessionId = lineage.parentSessionId;
        }
        if (lineage?.kind) {
          current.kind = lineage.kind;
        }
        if (typeof lineage?.depth === 'number') {
          current.depth = lineage.depth;
        }
        if (lineage?.subagentStatus) {
          current.subagentStatus = lineage.subagentStatus;
        }
        if (lineage?.task) {
          current.task = lineage.task;
        }
        if (lineage?.presentation) {
          current.presentation = lineage.presentation;
        }
        applySubagentLineage(current, lineage);
        await upsertSessionRecord(indexPath, current);
      } else {
        const recordInput: Parameters<typeof createSessionRecord>[0] = {
          id: session.id,
          projectPath,
          ...(sessionName ? { name: sessionName } : {}),
        };
        if (!projectPath) {
          recordInput.scope = { kind: 'general' };
          recordInput.workingDirectory = getPiwinGeneralWorkspacePath(rootDir);
        } else {
          recordInput.scope = { kind: 'project', projectPath };
          recordInput.workingDirectory = projectPath;
        }
        if (lineage?.parentSessionId) {
          recordInput.parentSessionId = lineage.parentSessionId;
        }
        if (lineage?.kind) {
          recordInput.kind = lineage.kind;
        }
        if (typeof lineage?.depth === 'number') {
          recordInput.depth = lineage.depth;
        }
        if (lineage?.subagentStatus) {
          recordInput.subagentStatus = lineage.subagentStatus;
        }
        if (lineage?.task) {
          recordInput.task = lineage.task;
        }
        if (lineage?.presentation) {
          recordInput.presentation = lineage.presentation;
        }
        copySubagentLineage(recordInput, lineage);
        await upsertSessionRecord(indexPath, createSessionRecord(recordInput));
      }
    } catch (error) {
      const detail = formatError(error);
      const warning = `session index write failed: ${detail}`;
      console.warn(warning);
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: warning,
      });
      throw error instanceof Error ? error : new Error(warning);
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

  // Apply durable auto-compaction default (or session override) when handle supports it.
  void deps.applyAutoCompactionToSession(session).catch((error: unknown) => {
    const message = formatError(error);
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `auto-compaction apply failed: ${message}`,
    });
  });
}
