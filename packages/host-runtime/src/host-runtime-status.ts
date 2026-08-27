/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { totalmem } from 'node:os';
import type { HostStatusData } from '@piwin/contracts';
import {
  deriveMemoryHighWaterMiB,
  formatError,
  normalizeSessionRuntimeRetentionConfig,
  type SessionRuntimeRetentionConfig,
} from '@piwin/contracts';

import { recoverJournaledColdStorageTransactions } from '@piwin/session';
import { loadPiwinConfig } from './config-store.js';
import {
  getPiwinGeneralWorkspacePath,
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionMediaDir,
  getPiwinSessionTranscriptDatabasePath,
} from './paths.js';
import { fail } from './response-helpers.js';
import { RunRegistry } from './run-registry.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import type {
  HostForegroundRunSnapshot,
  HostPendingPermissionSnapshot,
} from './host-runtime-types.js';

export async function ensureColdStorageRecovered(deps: HostRuntimeKernel): Promise<void> {
  if (deps.coldStorageRecovery === null) {
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    deps.coldStorageRecovery = recoverJournaledColdStorageTransactions({
      rootDir,
      indexPath: getPiwinSessionIndexPath(rootDir),
      resolvePaths: (sessionId) => ({
        transcriptPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
        mediaDir: getPiwinSessionMediaDir(rootDir, sessionId),
      }),
    })
      .then((result) => {
        if (result.recovered.length === 0 && result.reports.length === 0) {
          return;
        }
        deps.push({
          type: 'host/log',
          level: 'info',
          message: `[cold-storage] recovered ${result.recovered.length} journal(s)`,
        });
      })
      .catch((error: unknown) => {
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `[cold-storage] journal recovery failed: ${formatError(error)}`,
        });
      });
  }
  await deps.coldStorageRecovery;
}

export async function ensureRuntimeRetentionLoaded(deps: HostRuntimeKernel): Promise<void> {
  if (deps.runtimeRetentionInitialization === null) {
    deps.runtimeRetentionInitialization = loadPiwinConfig(deps.options.piwinRoot)
      .then((config) => {
        deps.applyRuntimeRetention(config.session?.runtimeRetention);
      })
      .catch((error: unknown) => {
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `[residency] failed to load runtime retention; defaults remain active: ${formatError(error)}`,
        });
      });
  }
  await deps.runtimeRetentionInitialization;
}

export function applyRuntimeRetention(
  deps: HostRuntimeKernel,
  input: Partial<SessionRuntimeRetentionConfig> | undefined,
): void {
  const normalized = normalizeSessionRuntimeRetentionConfig(input);
  const memoryHighWaterMiB =
    normalized.memoryHighWaterMiB ?? deriveMemoryHighWaterMiB(totalmem() / 1024 / 1024);
  deps.runtimeRetention = normalized;
  deps.runtimeMemoryHighWaterMiB = memoryHighWaterMiB;
  deps.residencyController.updateRetention({
    ...normalized,
    memoryHighWaterMiB,
  });
}

export function getStatus(deps: HostRuntimeKernel): HostStatusData {
  return {
    mode: deps.host.mode,
    ready: deps.ready,
    mock: deps.options.mock === true || process.env.PIWIN_MOCK === '1',
    piwinRoot: getPiwinRoot(deps.options.piwinRoot),
    generalWorkspacePath: getPiwinGeneralWorkspacePath(getPiwinRoot(deps.options.piwinRoot)),
    activeSessionIds: [...deps.sessions.keys()],
    capabilities: {
      // True only when the real parent-owned session tool port is composed
      // (non-mock live path). Mock has no product tool executors wired.
      customTools: deps.sessionHostToolPort !== null,
      mcpLifecycle: true,
      productTranscript: true,
      // Compaction requires a live handle with compact(); SDK/mock support it.
      compaction: deps.host.mode === 'sdk' || deps.options.mock === true || deps.isRpcWorkerMode(),
      extensions: deps.host.mode === 'sdk' || deps.isRpcWorkerMode() || deps.options.mock === true,
      prompts: deps.host.mode === 'sdk' || deps.isRpcWorkerMode() || deps.options.mock === true,
      extensionUiBridge: true,
      sessionSearch: true,
      sessionPin: true,
      sessionLifecycle: true,
      sessionPause: true,
      runInterventions: true,
      queuedTurns: true,
      runtimeResidency: true,
      sessionOutlinePage: true,
      sessionUserMessageIndex: true,
      sessionTranscriptSeek: true,
      usage: true,
      process: true,
      // Keep this fail-closed if construction or the command surface ever
      // regresses; a mode alone is not evidence that jobs are available.
      jobs: deps.hasUsableJobController(),
      sessionExport: true,
      // ADR 0013: real Tauri PTY not shipped — do not claim interactive PTY.
      pty: false,
      // ADR 0030: subagent worktree is available when the orchestrator is composed.
      subagentWorktree: deps.subagentOrchestrator !== null,
      marketplaceHub: true,
      automation: true,
    },
  };
}

export function hasUsableJobController(deps: HostRuntimeKernel): boolean {
  const controller = deps.jobController;
  if (!controller) {
    return false;
  }
  return (
    typeof controller.start === 'function' &&
    typeof controller.list === 'function' &&
    typeof controller.get === 'function' &&
    typeof controller.readLogs === 'function' &&
    typeof controller.wait === 'function' &&
    typeof controller.stop === 'function'
  );
}

export function pushStatus(deps: HostRuntimeKernel): void {
  const status = deps.getStatus();
  deps.push({
    type: 'host/status',
    mode: status.mode,
    ready: status.ready,
    mock: status.mock,
  });
}

/**
 * Live foreground session-turns for remote hydration. Narrow projection so
 * HostServer does not read RunRegistry internals.
 */
export function listForegroundRuns(deps: HostRuntimeKernel): HostForegroundRunSnapshot[] {
  const snapshots: HostForegroundRunSnapshot[] = [];
  const seenSessions = new Set<string>();
  const activeTurns = deps.runRegistry.list({
    kind: 'session-turn',
    status: ['queued', 'running', 'cancelling'],
  });
  for (const candidate of activeTurns) {
    if (seenSessions.has(candidate.sessionId)) {
      continue;
    }
    const foreground = deps.runRegistry.getForegroundRun(candidate.sessionId);
    if (
      foreground === undefined ||
      (foreground.status !== 'queued' &&
        foreground.status !== 'running' &&
        foreground.status !== 'cancelling')
    ) {
      continue;
    }
    seenSessions.add(foreground.sessionId);
    snapshots.push({
      sessionId: foreground.sessionId,
      runId: foreground.runId,
      status: foreground.status,
      ...(foreground.phase === undefined ? {} : { phase: foreground.phase }),
    });
  }
  return snapshots;
}

/**
 * Pending permission request ids for remote hydration. Request identity only.
 */
export function listPendingPermissionRequests(
  deps: HostRuntimeKernel,
): HostPendingPermissionSnapshot[] {
  const snapshots: HostPendingPermissionSnapshot[] = [];
  for (const [requestId, pending] of deps.pendingPermissions) {
    snapshots.push({ sessionId: pending.sessionId, requestId, action: pending.action });
  }
  return snapshots;
}
