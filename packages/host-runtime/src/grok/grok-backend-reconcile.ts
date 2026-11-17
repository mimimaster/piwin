import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getPiwinRoot } from '../paths.js';
import { listExtensionBackends, type ExtensionBackend } from '../extension-session-backends.js';

/**
 * Terminate control bridges and idle session handles for any external agent
 * extension that is no longer enabled in the extension registry.
 */
export async function reconcileDisabledExternalAgentBackends(
  deps: HostRuntimeKernel,
  preloadedBackends?: readonly ExtensionBackend[],
): Promise<void> {
  const externalAgents = deps.externalAgents;
  if (externalAgents === undefined) return;
  const loadedAgentIds = externalAgents.listLoadedAgentIds();
  if (loadedAgentIds.length === 0) return;

  const installed = preloadedBackends ?? (await listExtensionBackends(getPiwinRoot(deps.options.piwinRoot)));
  const enabledAgentIds = new Set(
    installed.filter((backend) => backend.enabled).map((backend) => backend.declaration.id),
  );
  const disabledAgentIds = loadedAgentIds.filter((agentId) => !enabledAgentIds.has(agentId));
  if (disabledAgentIds.length === 0) return;

  const activeSessionIds = new Set(
    deps.runRegistry
      .list({ status: ['queued', 'running', 'cancelling'] })
      .map((run) => run.sessionId),
  );

  for (const agentId of disabledAgentIds) {
    await externalAgents.disposeControl(agentId);
    for (const sessionId of externalAgents.listSessionIdsForAgent(agentId)) {
      if (activeSessionIds.has(sessionId)) continue;
      if (deps.agentCliOwnership?.isDesktopWriterBlocked(sessionId) === true) continue;
      await deps.disposeLiveSession(sessionId, 'manual');
      await externalAgents.disposeSession(sessionId);
    }
  }
}
