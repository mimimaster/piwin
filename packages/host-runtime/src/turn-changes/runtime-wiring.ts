/**
 * Open the Host turn-change store. Production uses getPiwinRoot()/turn-changes;
 * tests inject rootDir (mkdtemp) and must not write to ~/.piwin.
 */
import { join } from 'node:path';

import type { HostPush } from '@piwin/contracts';
import {
  createTurnChangeObjectStore,
  openTurnChangeStore,
  recoverTurnChangeOperation,
  type TurnChangeObjectStore,
  type TurnChangeStore,
} from '@piwin/git';
import { getPiwinGeneralWorkspacePath, getPiwinRoot } from '../paths.js';
import {
  createTurnChangeCoordinator,
  type TurnChangeCoordinator,
} from './coordinator.js';
import { createExecutionTracker, type ExecutionTracker } from './execution-tracker.js';
import { createToolCapturePort, type ToolCapturePort } from './tool-capture.js';
import { createTurnChangeSealer, type TurnChangeSealer } from './turn-seal.js';
import { createWorkspaceWriteGate, type WorkspaceWriteGate } from './workspace-write-gate.js';

export type TurnChangeRuntime = {
  store: TurnChangeStore;
  coordinator: TurnChangeCoordinator;
  gate: WorkspaceWriteGate;
  tracker: ExecutionTracker;
  capture: ToolCapturePort;
  objectStore: TurnChangeObjectStore;
  sealer: TurnChangeSealer;
  close(): void;
};

export function resolveTurnChangeRuntimeRoot(piwinRoot?: string): string {
  return join(getPiwinRoot(piwinRoot), 'turn-changes');
}

/**
 * Workspace root used for turn-change capture and the exclusive write gate.
 * Empty `projectPath` is the bindSession General-session convention, not cwd.
 */
export function resolveTurnChangeWorkspaceRoot(input: {
  projectPath?: string | undefined;
  piwinRoot?: string | undefined;
  childWorkingDirectory?: string | undefined;
}): string {
  const childWorkingDirectory = input.childWorkingDirectory?.trim();
  if (childWorkingDirectory) {
    return childWorkingDirectory;
  }
  const projectPath = input.projectPath?.trim();
  if (projectPath) {
    return projectPath;
  }
  return getPiwinGeneralWorkspacePath(getPiwinRoot(input.piwinRoot));
}

export function openTurnChangeRuntime(options: {
  hostInstanceId: string;
  piwinRoot?: string;
  rootDir?: string;
  /** Announces sealed / undone / redone turns to clients. */
  push?: (message: HostPush) => void;
}): TurnChangeRuntime {
  const rootDir = options.rootDir ?? resolveTurnChangeRuntimeRoot(options.piwinRoot);
  const store = openTurnChangeStore({ rootDir });
  const coordinator = createTurnChangeCoordinator({
    store,
    hostInstanceId: options.hostInstanceId,
  });
  const gate = createWorkspaceWriteGate();
  const tracker = createExecutionTracker();
  const capture = createToolCapturePort({
    store,
    alignWorkspace: (runId, workspaceRoot) => coordinator.alignWorkspace(runId, workspaceRoot),
  });
  const objectStore = createTurnChangeObjectStore({ rootDir });
  const sealer = createTurnChangeSealer({
    store,
    objectStore,
    waitRunSettled: (runId, timeoutMs) => capture.waitRunSettled(runId, timeoutMs),
    ...(options.push ? { push: options.push } : {}),
  });
  return {
    store,
    coordinator,
    gate,
    tracker,
    capture,
    objectStore,
    sealer,
    close() {
      store.close();
    },
  };
}

export type TurnChangeStartupRecovery = {
  /** Undo/redo operations found mid-apply, with their recovered status. */
  operations: Array<{ operationId: string; status: string }>;
  /** Segments the previous Host left open; their turns can now be sealed. */
  orphanedRunIds: string[];
};

/**
 * Host startup: no run survives a restart, so open segments are closed (their
 * turns become sealable on first query), and undo/redo operations interrupted
 * mid-apply are finished or rolled back from their per-file backups.
 */
export async function recoverTurnChangeRuntimeAtStartup(
  runtime: Pick<TurnChangeRuntime, 'store' | 'objectStore'>,
  now: () => Date = () => new Date(),
): Promise<TurnChangeStartupRecovery> {
  const orphanedRunIds = runtime.store.endOrphanedRunSegments(now().toISOString());
  const operations: TurnChangeStartupRecovery['operations'] = [];
  for (const operation of runtime.store.listOperationsByStatus('applying')) {
    // Subagent apply has its own reservation-based recovery.
    if (operation.kind !== 'undo' && operation.kind !== 'redo') {
      continue;
    }
    const attempt = runtime.store.getAttempt(operation.changeSetId);
    const workspace = attempt ? runtime.store.getWorkspace(attempt.workspaceId) : undefined;
    if (!workspace) {
      runtime.store.updateOperationStatus(operation.operationId, 'needs-repair');
      operations.push({ operationId: operation.operationId, status: 'needs-repair' });
      continue;
    }
    const recovered = await recoverTurnChangeOperation({
      workspaceRoot: workspace.rootPath,
      store: runtime.store,
      objectStore: runtime.objectStore,
      operationId: operation.operationId,
    });
    operations.push(recovered);
  }
  return { operations, orphanedRunIds };
}
