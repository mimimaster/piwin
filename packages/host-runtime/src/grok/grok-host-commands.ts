/**
 * HostCommand handlers for ADR 0082 external agents. Runs ahead of the
 * domain chain so Grok sessions never fall through to Pi-only handlers, and
 * rename/delete write through to the Grok catalog.
 */

import type { HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { GROK_AGENT_ID } from './grok-capabilities.js';
import { createAgentPluginInventory, handleAgentPluginCommand, requireEnabledAgentPlugin } from './agent-plugin-inventory.js';
import {
  deleteGrokSessionEverywhere,
  handleSessionBackendCommand,
  isGrokRecord,
  rejectUnsupportedExternalCommand,
  renameGrokSession,
  syncGrokCatalog,
} from './grok-session-router.js';

export async function handleExternalAgentCommand(
  deps: HostRuntimeKernel,
  command: HostCommand,
  requestId: string | undefined,
): Promise<HostResponse | null> {
  const pluginResponse = await handleAgentPluginCommand(deps, command, requestId);
  if (pluginResponse !== null) return pluginResponse;
  switch (command.type) {
    case 'agents/status': {
      if (command.agentId !== undefined && command.agentId !== GROK_AGENT_ID) {
        return fail(requestId, command.type, `unknown-agent: ${command.agentId}`);
      }
      if (deps.grokBackend === undefined) {
        return ok(requestId, command.type, { agents: [] });
      }
      const plugin = await createAgentPluginInventory(getPiwinRoot(deps.options.piwinRoot)).get(GROK_AGENT_ID);
      if (plugin === undefined) return ok(requestId, command.type, { agents: [] });
      if (!plugin.enabled) return ok(requestId, command.type, { agents: [{ agentId: plugin.agentId, state: 'unavailable', binaryPath: '', reason: 'Agent adapter disabled. Enable it before checking the CLI.', checkedAt: new Date().toISOString() }] });
      const status = command.refresh === true
        ? await deps.grokBackend.getStatus(true)
        : deps.grokBackend.peekStatus();
      return ok(requestId, command.type, { agents: [status ?? { agentId: plugin.agentId, state: 'unavailable', binaryPath: plugin.runtime.binaryPath ?? '', reason: 'CLI not checked. Choose Check again on the Host.', checkedAt: new Date().toISOString() }], installed: [plugin.agentId] });
    }
    case 'agents/mcp-status':
      if (command.agentId !== GROK_AGENT_ID) return fail(requestId, command.type, 'unknown-agent');
      return ok(requestId, command.type, {
        agentId: command.agentId,
        ...(deps.grokBackend?.getMcpStatuses() ?? { servers: [], observed: false }),
      });
    case 'agents/sessions-sync':
      if (command.agentId !== GROK_AGENT_ID) {
        return fail(requestId, command.type, `unknown-agent: ${command.agentId}`);
      }
      return syncGrokCatalog(deps, requestId);
    case 'session/backend-get':
    case 'session/backend-set':
      return handleSessionBackendCommand(deps, command, requestId);
    case 'session/rename': {
      const record = await getSessionRecord(indexPathOf(deps), command.sessionId);
      if (!isGrokRecord(record) || record === undefined) {
        return null;
      }
      try {
        await renameGrokSession(deps, record, command.name);
      } catch (error) {
        return fail(requestId, command.type, formatError(error));
      }
      // Fall through to the product handler would double-write; answer here.
      const renamed = await getSessionRecord(indexPathOf(deps), command.sessionId);
      if (renamed?.name !== undefined) {
        deps.push({ type: 'session/name-updated', sessionId: renamed.id, name: renamed.name, nameSource: 'user' });
      }
      return ok(requestId, command.type, {
        sessionId: command.sessionId,
        name: renamed?.name,
        ...(renamed !== undefined ? { session: indexRecordToSummary(renamed) } : {}),
      });
    }
    case 'session/delete': {
      const record = await getSessionRecord(indexPathOf(deps), command.sessionId);
      if (!isGrokRecord(record) || record === undefined) {
        return null;
      }
      const liveRun = deps.runRegistry.getForegroundRun(command.sessionId);
      if (liveRun !== undefined && command.force !== true) {
        return fail(requestId, command.type, 'session-busy: stop the running turn before deleting', {
          code: 'session-busy',
        });
      }
      try {
        if (liveRun !== undefined) {
          await deps.abortLiveSession(command.sessionId);
        }
        // Grok is the source of truth: delete there first. A product-side
        // failure afterwards is repaired by the next catalog sync.
        await deleteGrokSessionEverywhere(deps, record);
        const deletion = await deps.deleteSessionForMaintenance(command.sessionId);
        deps.push(sessionIndexUpdatedPush({ op: 'deleted', sessionId: command.sessionId }));
        return ok(requestId, command.type, {
          sessionId: command.sessionId,
          deleted: true,
          ...(deletion?.cleanupWarning ? { cleanupWarning: deletion.cleanupWarning } : {}),
        });
      } catch (error) {
        return fail(requestId, command.type, formatError(error));
      }
    }
    default: {
      if (command.type === 'session/queued-turn-submit' || command.type === 'session/replace-run') {
        const record = await getSessionRecord(indexPathOf(deps), command.sessionId);
        if (isGrokRecord(record)) {
          try { await requireEnabledAgentPlugin(getPiwinRoot(deps.options.piwinRoot)); }
          catch (error) { return fail(requestId, command.type, formatError(error)); }
        }
      }
      const sessionId = 'sessionId' in command ? command.sessionId : undefined;
      return rejectUnsupportedExternalCommand(
        deps,
        { type: command.type, ...(sessionId !== undefined ? { sessionId } : {}) },
        requestId,
      );
    }
  }
}

function indexPathOf(deps: HostRuntimeKernel): string {
  return getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
}
