/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';
import type {
  HostCommand,
  HostResponse,
  SettingsDomainImpact,
  SettingsApplyResult,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

import { fail, ok } from './response-helpers.js';
import { projectActivitySummary } from './activity-summary.js';
import { dispatchDomainCommands } from './commands/domain-command-dispatch.js';
import { handleSessionLiveCommand } from './commands/session-live-commands.js';
import { handleWalkthroughCancel } from './commands/walkthrough-commands.js';
import { handleFlashcardCancelExplanation } from './commands/flashcard-selection-commands.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import {
  EXTENSION_REGISTRY_MUTATING_COMMANDS,
  TRANSCRIPT_STORE_LEASED_COMMANDS,
} from './host-runtime-types.js';

export async function handleCommand(
  deps: HostRuntimeKernel,
  command: HostCommand,
): Promise<HostResponse> {
  try {
    deps.rootLease?.assertHeld();
  } catch (error) {
    return fail(
      typeof command.id === 'string' ? command.id : undefined,
      command.type,
      `piwin root ownership unavailable: ${formatError(error)}`,
    );
  }
  if (TRANSCRIPT_STORE_LEASED_COMMANDS.has(command.type)) {
    return deps.transcriptStores.withCommandLease(
      () => deps.handleCommandWithTranscriptLease(command),
      (sessionId) => deps.sessions.has(sessionId) || deps.transcriptRecorders.has(sessionId),
    );
  }
  return deps.handleCommandWithTranscriptLease(command);
}

export async function handleCommandWithTranscriptLease(
  deps: HostRuntimeKernel,
  command: HostCommand,
): Promise<HostResponse> {
  const requestId = typeof command.id === 'string' ? command.id : undefined;
  try {
    // Heartbeat and status must not wait on journal recovery. A 3s remote
    // host/status or 10s ping timeout otherwise paints the shell as offline
    // while Host is still walking ~/.piwin on first boot.
    if (command.type !== 'host/ping' && command.type !== 'host/status') {
      await deps.ensureRuntimeRetentionLoaded();
      await deps.ensureColdStorageRecovered();
    }
    // §8.1: walkthrough/cancel is a control-channel request that must bypass
    // the normal long-task dispatch chain and abort the in-flight generation
    // immediately. Handle it before buildDomainCommands so it is never queued
    // behind a slow domain handler or a live session operation.
    if (command.type === 'walkthrough/cancel') {
      return handleWalkthroughCancel(
        command,
        requestId,
        deps.buildWalkthroughContext(),
        deps.walkthroughRegistry,
      );
    }
    if (command.type === 'flashcards/cancel-explanation') {
      return handleFlashcardCancelExplanation(
        command,
        requestId,
        deps.flashcardSelectionRegistry,
      );
    }
    if (EXTENSION_REGISTRY_MUTATING_COMMANDS.has(command.type)) {
      const recoveryFailure = await deps.blockUntilExtensionRecoverySettled(
        requestId,
        command.type,
      );
      if (recoveryFailure) {
        return recoveryFailure;
      }
    }
    if (command.type === 'extensions/apply') {
      const deploymentId = command.deploymentId ?? randomUUID();
      const existing = deps.extensionDeploymentPromisesById.get(deploymentId);
      if (existing) return existing;
      const operation = deps.executeExtensionApply({ ...command, deploymentId }, requestId);
      deps.extensionDeploymentPromisesById.set(deploymentId, operation);
      try {
        return await operation;
      } finally {
        if (deps.extensionDeploymentPromisesById.get(deploymentId) === operation) {
          deps.extensionDeploymentPromisesById.delete(deploymentId);
        }
      }
    }
    const ctx = await deps.buildDomainContext();
    const queuedTurn = await deps.queuedTurnController.handleCommand(command, requestId);
    if (queuedTurn) {
      return queuedTurn;
    }
    const domain = await dispatchDomainCommands(command, requestId, ctx);
    if (domain) {
      // Spec §12.3/12.4: when Settings change, mark the affected live
      // sessions stale and keep safety gates tight without aborting the
      // current run. Only runtime-stale domains are recorded.
      if (command.type === 'settings/apply' && domain.type === 'response' && domain.success) {
        const data = domain.data as SettingsApplyResult | null | undefined;
        if (Array.isArray(data?.changedDomains)) {
          const changedDomains = data.changedDomains;
          const settingsConfig = (
            domain.data as {
              snapshot?: { config?: import('@piwin/contracts').PiwinConfig };
            }
          ).snapshot?.config;
          if (settingsConfig?.permissions?.mode) {
            deps.permissionModeFromConfig = settingsConfig.permissions.mode;
          }
          if (settingsConfig?.session) {
            deps.applyRuntimeRetention(settingsConfig.session.runtimeRetention);
          }
          const runtimeChanges = changedDomains.filter(
            (change: SettingsDomainImpact) =>
              change.runtimeSchemaChanged ?? change.timing === 'new-runtime',
          );
          for (const sessionId of deps.sessions.keys()) {
            const activeGenerationId = deps.runtimeController.getStatus(sessionId).generationId;
            if (activeGenerationId === undefined || runtimeChanges.length === 0) {
              continue;
            }
            deps.runtimeController.recordSettingsChange(
              sessionId,
              runtimeChanges,
              data.snapshot.runtimeRevision,
            );
            void deps.runtimeReplacementEngine
              .replace({
                sessionId,
                targetSettingsRevision: data.snapshot.runtimeRevision,
                expectedActiveGenerationId: activeGenerationId,
                when: 'after-current-run',
              })
              .catch((error: unknown) => {
                deps.push({
                  type: 'host/log',
                  level: 'warn',
                  message: `automatic runtime update failed for ${sessionId}: ${formatError(error)}`,
                });
              });
          }
        }
      }
      return domain;
    }
    const sessionLive = await handleSessionLiveCommand(
      command,
      requestId,
      deps.buildSessionLiveContext(),
    );
    if (sessionLive) {
      return sessionLive;
    }
    switch (command.type) {
      case 'host/ping':
        return ok(requestId, 'host/ping', { pong: true });
      case 'host/status':
        return ok(requestId, 'host/status', deps.getStatus());
      case 'activity/summary':
        return ok(
          requestId,
          'activity/summary',
          projectActivitySummary({
            runs: deps.listForegroundRuns(),
            pendingPermissions: deps.listPendingPermissionRequests(),
            ...(command.maxItems === undefined ? {} : { maxItems: command.maxItems }),
          }),
        );
      case 'host/runtime-resources': {
        // Query-only aggregate metrics (ADR 0040 §8). Await the bounded
        // worker sample so a first query/Refresh click does not return the
        // previous cache and require a second poll for truthful diagnostics.
        await deps.refreshWorkerRssSample();
        return ok(requestId, 'host/runtime-resources', deps.getRuntimeResources());
      }

      default:
        return fail(requestId, 'unknown', 'Unhandled command');
    }
  } catch (error) {
    const message = formatError(error);
    return fail(requestId, command.type, message);
  }
}
