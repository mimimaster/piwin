/**
 * Compose the external agent backend into HostRuntime (ADR 0082). Lives outside
 * `host-runtime-init.ts` so the Pi composition path stays unchanged. The
 * backend serves every installed adapter; no vendor code lives in the Host.
 */

import { randomUUID } from 'node:crypto';
import { formatError } from '@piwin/contracts';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import type { HostRuntimeOptions } from '../host-runtime-types.js';
import { ExternalAgentBackend, type ExternalPendingPermission } from '../external-agent-backend.js';
import { applyExternalAgentTitle } from './grok-catalog-sync.js';
import { requireExtensionBackendLaunch } from '../extension-session-backends.js';
import { getPiwinRoot } from '../paths.js';

export function composeExternalAgentBackend(deps: HostRuntimeKernel, options: HostRuntimeOptions): void {
  const agents = options.externalAgents;
  // Mock Hosts never spawn real agents unless a test opts in.
  if (agents === false || (options.mock === true && agents === undefined)) {
    deps.externalAgents = undefined;
    return;
  }
  deps.externalAgents = new ExternalAgentBackend({
    push: (message) => deps.push(message),
    // HostRuntime's map carries Pi-only fields too; adapters use the shared subset.
    pendingPermissions: deps.pendingPermissions as unknown as Map<string, ExternalPendingPermission>,
    getForegroundRunId: (sessionId) => deps.runRegistry.getForegroundRun(sessionId)?.runId,
    onSessionTitle: (sessionId, title) => {
      void applyExternalAgentTitle(deps, sessionId, title).catch((error: unknown) => {
        deps.push({ type: 'host/log', level: 'warn', message: `agent title update failed: ${formatError(error)}` });
      });
    },
    onSessionTransportClosed: (sessionId, reason) => {
      deps.push({ type: 'host/log', level: 'warn', message: `agent process for ${sessionId} exited: ${reason}` });
      // The resident handle is dead; drop it so the next prompt reopens.
      // An in-flight prompt already resolved as a backend-worker-crash failure.
      void deps.disposeLiveSession(sessionId, 'manual').catch((error: unknown) => {
        deps.push({ type: 'host/log', level: 'warn', message: `agent session cleanup failed: ${formatError(error)}` });
      });
    },
    createRequestId: () => randomUUID(),
    ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
    // The extension registry is the single authority: an enabled extension
    // revision supplies the adapter. There is no second agent inventory.
    requireInstall: (agentId) => requireExtensionBackendLaunch(getPiwinRoot(options.piwinRoot), agentId),
    ...(agents?.env !== undefined ? { env: agents.env } : {}),
  });
}
