/**
 * Open the Host turn-change store. Production uses getPiwinRoot()/turn-changes;
 * tests inject rootDir (mkdtemp) and must not write to ~/.piwin.
 */
import { join } from 'node:path';

import {
  createTurnChangeObjectStore,
  openTurnChangeStore,
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
import { createWorkspaceWriteGate, type WorkspaceWriteGate } from './workspace-write-gate.js';

export type TurnChangeRuntime = {
  store: TurnChangeStore;
  coordinator: TurnChangeCoordinator;
  gate: WorkspaceWriteGate;
  tracker: ExecutionTracker;
  capture: ToolCapturePort;
  objectStore: TurnChangeObjectStore;
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
    resolveChangeSetId: (runId) => coordinator.getBindingByRun(runId)?.changeSetId,
  });
  const objectStore = createTurnChangeObjectStore({ rootDir });
  return {
    store,
    coordinator,
    gate,
    tracker,
    capture,
    objectStore,
    close() {
      store.close();
    },
  };
}
