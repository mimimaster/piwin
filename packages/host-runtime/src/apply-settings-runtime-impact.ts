import type { SettingsApplyResult, SettingsDomainImpact } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { applyExecutionAdmission } from './host-runtime-status.js';
import { applyHostNetworkProxy } from './network-proxy/host-network-proxy.js';

/**
 * Shared post-apply hook for settings/apply and OAuth-driven SettingsService writes.
 * Keeps runtimeRevision, permission mode, and replacement on one path.
 */
export function applySettingsRuntimeImpact(
  deps: HostRuntimeKernel,
  result: SettingsApplyResult,
): void {
  if (result.changedDomains.length === 0) {
    return;
  }
  const settingsConfig = result.snapshot.config;
  const speechChanged = result.changedDomains.some((change) => change.domain === 'speech');
  if (speechChanged) {
    deps.liveEnabledFromConfig = true;
  }
  if (settingsConfig.permissions?.mode) {
    deps.permissionModeFromConfig = settingsConfig.permissions.mode;
  }
  if (result.changedDomains.some((change) => change.domain === 'network')) {
    // Host-side fetch (OAuth, catalogs, web tools) switches now; agent workers
    // get the new variables with their replacement generation below.
    deps.push({
      type: 'host/log',
      level: 'info',
      message: applyHostNetworkProxy(settingsConfig.network),
    });
  }
  applyExecutionAdmission(deps, settingsConfig);
  if (settingsConfig.session) {
    deps.applyRuntimeRetention(settingsConfig.session.runtimeRetention);
  }
  deps.applyWorkerPoolSize(settingsConfig.subagents?.maxConcurrency);
  const runtimeChanges = result.changedDomains.filter(
    (change: SettingsDomainImpact) =>
      change.runtimeSchemaChanged ?? change.timing === 'new-runtime',
  );
  if (runtimeChanges.length === 0) {
    return;
  }
  for (const sessionId of deps.sessions.keys()) {
    const activeGenerationId = deps.runtimeController.getStatus(sessionId).generationId;
    // External agents own their config; a Pi candidate would replace the agent.
    if (activeGenerationId === undefined || deps.runtimeController.isExternalAgentGeneration(sessionId)) {
      continue;
    }
    deps.runtimeController.recordSettingsChange(
      sessionId,
      runtimeChanges,
      result.snapshot.runtimeRevision,
    );
    void deps.runtimeReplacementEngine
      .replace({
        sessionId,
        targetSettingsRevision: result.snapshot.runtimeRevision,
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
