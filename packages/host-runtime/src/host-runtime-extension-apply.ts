/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import type {
  HostCommand,
  HostResponse,
  ExtensionDeploymentRecord,
  ExtensionsApplyData,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { scanExtensions } from './extension-scanner.js';

import { getSessionRecord } from '@piwin/session';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { fail, ok } from './response-helpers.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import type { ExtensionApplyCommand, ExtensionDeploymentPatch } from './host-runtime-types.js';
import {
  EXTENSION_DEPLOYMENT_IN_FLIGHT_PHASES,
  extensionApplyDataFromRecord,
} from './host-runtime-types.js';

/**
 * Startup recovery for durable extension deployments (ADR 0047). A record
 * still in an in-flight phase belongs to a Host process that no longer
 * exists — its background continuation was memory-only. Journal is the
 * recovery source of truth; registry revision is the desired-config source
 * of truth. Only a leftover whose target still matches the current registry
 * can be terminalized as `active`. A stale target becomes `superseded`.
 * Store/registry read failures fail closed so a later apply cannot pretend
 * recovery succeeded.
 */
export async function recoverInterruptedExtensionDeployments(
  deps: HostRuntimeKernel,
): Promise<void> {
  const registry = await deps.extensionRevisionStore.readRegistry();
  const deployments = await deps.extensionRevisionStore.listDeployments();
  const failures: unknown[] = [];
  for (const record of deployments) {
    if (!EXTENSION_DEPLOYMENT_IN_FLIGHT_PHASES.has(record.phase)) {
      continue;
    }
    if (deps.extensionDeploymentPromisesById.has(record.deploymentId)) {
      continue;
    }
    try {
      if (record.targetRegistryRevision === registry.revision) {
        await deps.updateExtensionDeployment(record, { phase: 'active' });
      } else {
        await deps.updateExtensionDeployment(record, {
          phase: 'superseded',
          error: 'target registry revision is no longer current',
        });
      }
    } catch (error) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `extension deployment recovery failed for ${record.deploymentId}: ${formatError(error)}`,
      });
      // A record left in-flight is exactly the state later commands must not
      // trust, so an unpersisted terminalization has to fail the whole
      // recovery instead of silently allowing the next apply.
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw failures.length === 1
      ? failures[0]
      : new AggregateError(failures, 'extension deployment recovery could not terminalize');
  }
}

/**
 * Extension registry state is only trustworthy after startup recovery has
 * terminalized leftovers. Recovery decides `active` vs `superseded` from one
 * registry read, so a mutation racing that decision would make it stale:
 * both apply and registry mutations wait here and fail closed together.
 */
export async function blockUntilExtensionRecoverySettled(
  deps: HostRuntimeKernel,
  requestId: string | undefined,
  commandType: HostCommand['type'],
): Promise<HostResponse | null> {
  try {
    await deps.extensionDeploymentStartupRecovery;
    return null;
  } catch (error) {
    return fail(
      requestId,
      commandType,
      `extension-deployment-recovery-failed: ${formatError(error)}`,
    );
  }
}

export async function executeExtensionApply(
  deps: HostRuntimeKernel,
  command: ExtensionApplyCommand,
  requestId: string | undefined,
): Promise<HostResponse> {
  const recoveryFailure = await deps.blockUntilExtensionRecoverySettled(
    requestId,
    'extensions/apply',
  );
  if (recoveryFailure) {
    return recoveryFailure;
  }
  const registry = await deps.extensionRevisionStore.readRegistry();
  if (
    command.expectedRegistryRevision !== undefined &&
    command.expectedRegistryRevision !== registry.revision
  ) {
    return fail(
      requestId,
      'extensions/apply',
      `extension-registry-revision-conflict: expected ${command.expectedRegistryRevision}, current ${registry.revision}`,
    );
  }

  const persisted = await deps.extensionRevisionStore.readDeployment(command.deploymentId);
  if (persisted && persisted.sessionId !== command.sessionId) {
    return fail(
      requestId,
      'extensions/apply',
      `extension-deployment-session-conflict: ${command.deploymentId}`,
    );
  }
  if (persisted && persisted.sessionId === command.sessionId) {
    if (persisted.phase === 'active') {
      return ok(requestId, 'extensions/apply', extensionApplyDataFromRecord(persisted));
    }
    if (persisted.phase === 'superseded') {
      return fail(
        requestId,
        'extensions/apply',
        `extension-deployment-superseded: ${command.deploymentId}`,
      );
    }
    if (
      EXTENSION_DEPLOYMENT_IN_FLIGHT_PHASES.has(persisted.phase) &&
      deps.extensionDeploymentIdsBySession.get(command.sessionId) === command.deploymentId
    ) {
      // The deployment is still being applied by this process, possibly in
      // the background after a waiting-current-run quick ACK. Re-ACK the
      // same durable lifecycle instead of starting a conflicting apply for
      // the same id. An in-flight record *without* a live continuation here
      // is a leftover from an interrupted Host (startup recovery normally
      // terminalizes it); fall through and start a fresh lifecycle.
      return ok(
        requestId,
        'extensions/apply',
        extensionApplyDataFromRecord(
          persisted,
          command.when === 'after-current-run' ? 'waiting-current-run' : 'pending',
        ),
      );
    }
  }

  const activeDeploymentId = deps.extensionDeploymentIdsBySession.get(command.sessionId);
  if (activeDeploymentId !== undefined && activeDeploymentId !== command.deploymentId) {
    return fail(
      requestId,
      'extensions/apply',
      `extension-deployment-in-progress: ${activeDeploymentId}`,
    );
  }

  const now = new Date().toISOString();
  let deployment: ExtensionDeploymentRecord = {
    deploymentId: command.deploymentId,
    sessionId: command.sessionId,
    targetRegistryRevision: registry.revision,
    ...(command.targetExtensionSetRevision !== undefined
      ? { targetExtensionSetRevision: command.targetExtensionSetRevision }
      : {}),
    ...(command.expectedSettingsRevision !== undefined
      ? { expectedSettingsRevision: command.expectedSettingsRevision }
      : {}),
    when: command.when,
    phase: 'queued',
    createdAt: now,
    updatedAt: now,
  };

  await deps.writeExtensionDeployment(deployment);
  deps.extensionDeploymentIdsBySession.set(command.sessionId, command.deploymentId);
  deps.runtimeController.setExtensionDeploymentPending(command.sessionId, command.deploymentId);

  try {
    deployment = await deps.updateExtensionDeployment(deployment, { phase: 'validating' });

    const durableSession = await getSessionRecord(
      getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot)),
      command.sessionId,
    );
    if (!durableSession && !deps.sessions.has(command.sessionId)) {
      throw new Error(`Unknown session: ${command.sessionId}`);
    }

    if (command.when === 'new-sessions-only' || !deps.sessions.has(command.sessionId)) {
      deployment = await deps.updateExtensionDeployment(deployment, { phase: 'active' });
      deps.runtimeController.clearExtensionDeploymentPending(command.sessionId);
      return ok(
        requestId,
        'extensions/apply',
        extensionApplyDataFromRecord(deployment, 'new-sessions-only'),
      );
    }

    deps.requireSession(command.sessionId);
    const status = deps.runtimeController.getStatus(command.sessionId);
    const expectedSettingsRevision = command.expectedSettingsRevision ?? status.settingsRevision;
    if (expectedSettingsRevision === undefined) {
      throw new Error('extension-apply-settings-revision-missing');
    }
    if (
      status.settingsRevision !== undefined &&
      status.settingsRevision !== expectedSettingsRevision
    ) {
      throw new Error('extension-apply-settings-revision-conflict');
    }

    deps.runtimeController.recordSettingsChange(
      command.sessionId,
      ['extensions'],
      expectedSettingsRevision,
    );
    if (command.targetExtensionSetRevision !== undefined) {
      deps.runtimeController.setExtensionDeploymentTarget(
        command.sessionId,
        command.targetExtensionSetRevision,
        command.deploymentId,
      );
    }
    const runInFlight = deps.runRegistry
      .list({ status: ['queued', 'running', 'cancelling'] })
      .some((run) => run.sessionId === command.sessionId);
    deployment = await deps.updateExtensionDeployment(deployment, {
      phase:
        runInFlight && command.when === 'after-current-run' ? 'waiting-current-run' : 'compiling',
      ...(expectedSettingsRevision ? { expectedSettingsRevision } : {}),
    });

    if (deployment.phase === 'waiting-current-run') {
      // Job/lifecycle model (ADR 0047): the durable deployment record owns
      // the state. Quick-ACK now so a long Agent Run cannot time this
      // request out — the dispatcher's 45s deadline would otherwise report
      // a false failure while the serialized apply keeps running, and a
      // second apply could then overlap the first. Completion and failures
      // are reported through the existing `extension/deployment-updated`
      // push. The session keeps its deployment id until the background
      // activation finishes.
      const backgroundCompletion = deps.finishExtensionApplyInBackground(
        command,
        deployment,
        expectedSettingsRevision,
      );
      void backgroundCompletion
        .catch(() => undefined)
        .finally(() => {
          if (
            deps.extensionDeploymentIdsBySession.get(command.sessionId) === command.deploymentId
          ) {
            deps.extensionDeploymentIdsBySession.delete(command.sessionId);
          }
        });
      return ok(
        requestId,
        'extensions/apply',
        extensionApplyDataFromRecord(deployment, 'waiting-current-run'),
      );
    }

    try {
      return await deps.activateExtensionApply(
        command,
        requestId,
        deployment,
        expectedSettingsRevision,
      );
    } finally {
      if (deps.extensionDeploymentIdsBySession.get(command.sessionId) === command.deploymentId) {
        deps.extensionDeploymentIdsBySession.delete(command.sessionId);
      }
    }
  } catch (error) {
    const message = formatError(error);
    const status = deps.runtimeController.getStatus(command.sessionId);
    const phase =
      status.candidateState === 'active' && status.generationId !== undefined
        ? 'restart-required'
        : 'rolled-back';
    deployment = await deps.updateExtensionDeployment(deployment, {
      phase: 'failed',
      error: message,
    });
    await deps.updateExtensionDeployment(deployment, { phase, error: message });
    if (phase === 'restart-required') {
      deps.runtimeController.setExtensionRestartRequired(command.sessionId, true);
    } else {
      deps.runtimeController.clearExtensionDeploymentPending(command.sessionId);
    }
    if (deps.extensionDeploymentIdsBySession.get(command.sessionId) === command.deploymentId) {
      deps.extensionDeploymentIdsBySession.delete(command.sessionId);
    }
    return fail(requestId, 'extensions/apply', message);
  }
}

/**
 * Tail of an extensions/apply after the deployment reached `compiling` or
 * `waiting-current-run`: run the runtime replacement and publish the
 * activation. Shared by the synchronous path and the waiting-current-run
 * background continuation.
 */
export async function activateExtensionApply(
  deps: HostRuntimeKernel,
  command: ExtensionApplyCommand,
  requestId: string | undefined,
  deployment: ExtensionDeploymentRecord,
  expectedSettingsRevision: string,
): Promise<HostResponse> {
  const status = deps.runtimeController.getStatus(command.sessionId);
  const result = await deps.runtimeReplacementEngine.replace({
    sessionId: command.sessionId,
    targetSettingsRevision: expectedSettingsRevision,
    ...(status.generationId !== undefined
      ? { expectedActiveGenerationId: status.generationId }
      : {}),
    when: command.when === 'after-current-run' ? 'after-current-run' : 'now',
  });
  const targetExtensionSetRevision =
    result.candidate.extensionSetRevision ??
    deps.runtimeController.getStatus(command.sessionId).loadedExtensionSetRevision;
  const finalRegistry = await deps.extensionRevisionStore.readRegistry();
  for (const reference of await deps.extensionRevisionStore.listActiveRevisionRefs()) {
    try {
      await deps.extensionRevisionStore.markLastKnownGood(
        reference.extensionId,
        reference.contentRevision,
      );
    } catch (error) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `extension last-known-good update failed for ${reference.extensionId}: ${formatError(error)}`,
      });
    }
  }
  try {
    // The replaced generation no longer pins its revisions; finish any
    // uninstall that was waiting on it before the catalog push below.
    await deps.extensionRevisionStore.purgeRemoved(
      deps.runtimeController.listLoadedExtensionRevisions(),
    );
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `extension removal cleanup failed: ${formatError(error)}`,
    });
  }
  const registryAfterActivation = await deps.extensionRevisionStore.readRegistry();
  const activeConfig = await loadPiwinConfig(deps.options.piwinRoot);
  const catalog = await scanExtensions({
    piwinRoot: getPiwinRoot(deps.options.piwinRoot),
    ...(activeConfig.extensions ? { extensionsConfig: activeConfig.extensions } : {}),
  });
  deps.push({
    type: 'extension/catalog-updated',
    registryRevision: registryAfterActivation.revision,
    extensions: catalog,
  });
  let nextDeployment = await deps.updateExtensionDeployment(deployment, {
    phase: 'active',
    generationId: result.candidate.generationId,
    ...(targetExtensionSetRevision !== undefined ? { targetExtensionSetRevision } : {}),
  });
  const statusAfterActivation = deps.runtimeController.getStatus(command.sessionId);
  const data: ExtensionsApplyData = {
    sessionId: command.sessionId,
    deploymentId: nextDeployment.deploymentId,
    state: 'active',
    when: command.when,
    registryRevision: registryAfterActivation.revision || finalRegistry.revision,
    generationId: result.candidate.generationId,
    settingsRevision: result.candidate.settingsRevision,
    ...(targetExtensionSetRevision !== undefined
      ? { extensionSetRevision: targetExtensionSetRevision }
      : {}),
  };
  if (statusAfterActivation.restartRequired) {
    nextDeployment = await deps.updateExtensionDeployment(nextDeployment, {
      phase: 'restart-required',
    });
    return ok(requestId, 'extensions/apply', { ...data, state: 'active' });
  }
  return ok(requestId, 'extensions/apply', data);
}

/**
 * Background continuation for a `waiting-current-run` extension deployment.
 * The request already quick-ACKed; durable phase transitions (and failures)
 * reach clients through the existing `extension/deployment-updated` push.
 */
export async function finishExtensionApplyInBackground(
  deps: HostRuntimeKernel,
  command: ExtensionApplyCommand,
  deployment: ExtensionDeploymentRecord,
  expectedSettingsRevision: string,
): Promise<void> {
  try {
    await deps.activateExtensionApply(command, undefined, deployment, expectedSettingsRevision);
  } catch (error) {
    const message = formatError(error);
    const status = deps.runtimeController.getStatus(command.sessionId);
    const phase =
      status.candidateState === 'active' && status.generationId !== undefined
        ? 'restart-required'
        : 'rolled-back';
    await deps
      .updateExtensionDeployment(deployment, { phase: 'failed', error: message })
      .catch(() => undefined);
    await deps
      .updateExtensionDeployment(deployment, { phase, error: message })
      .catch(() => undefined);
    if (phase === 'restart-required') {
      deps.runtimeController.setExtensionRestartRequired(command.sessionId, true);
    } else {
      deps.runtimeController.clearExtensionDeploymentPending(command.sessionId);
    }
    deps.push({
      type: 'host/log',
      level: 'error',
      message: `extension apply failed for ${command.sessionId} (${command.deploymentId}): ${message}`,
    });
  }
}

export async function writeExtensionDeployment(
  deps: HostRuntimeKernel,
  record: ExtensionDeploymentRecord,
): Promise<void> {
  await deps.extensionRevisionStore.writeDeployment(record);
  deps.push({ type: 'extension/deployment-updated', deployment: record });
}

export async function updateExtensionDeployment(
  deps: HostRuntimeKernel,
  record: ExtensionDeploymentRecord,
  patch: ExtensionDeploymentPatch,
): Promise<ExtensionDeploymentRecord> {
  const next: ExtensionDeploymentRecord = {
    ...record,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await deps.writeExtensionDeployment(next);
  return next;
}
