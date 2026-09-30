/**
 * Compose the Grok Build backend into HostRuntime (ADR 0082). Lives outside
 * `host-runtime-init.ts` so the Pi composition path stays unchanged.
 */

import { randomUUID } from 'node:crypto';
import { formatError } from '@piwin/contracts';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import type { HostRuntimeOptions } from '../host-runtime-types.js';
import { GrokBackendService, type GrokPendingPermission } from './grok-backend-service.js';
import { applyGrokTitle } from './grok-session-router.js';
import { requireEnabledAgentPlugin } from './agent-plugin-inventory.js';
import { getPiwinRoot } from '../paths.js';

export function composeGrokBackend(deps: HostRuntimeKernel, options: HostRuntimeOptions): void {
  const grok = options.grok;
  // Mock Hosts never spawn real agents unless a test injects a transport.
  if (grok === false || (options.mock === true && grok === undefined)) {
    deps.grokBackend = undefined;
    return;
  }
  deps.grokBackend = new GrokBackendService({
    push: (message) => deps.push(message),
    // HostRuntime's map carries Pi-only fields too; Grok uses the shared subset.
    pendingPermissions: deps.pendingPermissions as unknown as Map<string, GrokPendingPermission>,
    getForegroundRunId: (sessionId) => deps.runRegistry.getForegroundRun(sessionId)?.runId,
    onSessionTitle: (sessionId, title) => {
      void applyGrokTitle(deps, sessionId, title).catch((error: unknown) => {
        deps.push({ type: 'host/log', level: 'warn', message: `grok title update failed: ${formatError(error)}` });
      });
    },
    onSessionTransportClosed: (sessionId, reason) => {
      deps.push({ type: 'host/log', level: 'warn', message: `grok process for ${sessionId} exited: ${reason}` });
      // The resident handle is dead; drop it so the next prompt reopens.
      // An in-flight prompt already resolved as a backend-worker-crash failure.
      void deps.disposeLiveSession(sessionId, 'manual').catch((error: unknown) => {
        deps.push({ type: 'host/log', level: 'warn', message: `grok session cleanup failed: ${formatError(error)}` });
      });
    },
    createRequestId: () => randomUUID(),
    requireEnabledPlugin: () => requireEnabledAgentPlugin(getPiwinRoot(options.piwinRoot)),
    ...(grok?.createTransport !== undefined ? { createTransport: grok.createTransport } : {}),
    ...(grok?.detect !== undefined ? { detect: grok.detect } : {}),
    ...(grok?.env !== undefined ? { env: grok.env } : {}),
  });
}
