/**
 * HostCommand handlers for ADR 0082 external agents. Runs ahead of the domain
 * chain so adapter-backed sessions never fall through to Pi-only handlers, and
 * rename/delete write through to the adapter catalog.
 *
 * Nothing here is keyed to a specific vendor: the agent id always comes from
 * the session record or the command, and the adapter is resolved from the
 * installed inventory.
 */

import type { ExternalAgentStatus, HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { handleExternalWorkflowCommand } from './grok-workflow-commands.js';
import {
  listExtensionBackends,
  requireEnabledExtensionBackend,
  verifyExtensionBackendArtifact,
} from '../extension-session-backends.js';
import {
  confirmExternalBindingMigration,
  deleteExternalSessionEverywhere,
  handleSessionBackendCommand,
  isExternalRecord,
  rejectUnsupportedExternalCommand,
  renameExternalSession,
  syncExternalAgentCatalog,
} from './grok-session-router.js';

export async function handleExternalAgentCommand(
  deps: HostRuntimeKernel,
  command: HostCommand,
  requestId: string | undefined,
): Promise<HostResponse | null> {
  if (command.type === 'agents/confirm-binding-migration') {
    return confirmExternalBindingMigration(deps, command, requestId);
  }
  const retired = retiredAgentInventoryGuidance(command, requestId);
  if (retired !== null) return retired;
  switch (command.type) {
    case 'agents/workflows':
    case 'agents/workflow-report':
      return handleExternalWorkflowCommand(deps, command, requestId);
    case 'agents/status': {
      const installed = await listExtensionBackends(getPiwinRoot(deps.options.piwinRoot));
      const wanted = command.agentId !== undefined
        ? installed.filter((backend) => backend.declaration.id === command.agentId)
        : installed;
      if (command.agentId !== undefined && wanted.length === 0) {
        return fail(requestId, command.type, `unknown-agent: ${command.agentId}`);
      }
      if (deps.externalAgents === undefined || wanted.length === 0) {
        return ok(requestId, command.type, { agents: [] });
      }
      const agents: ExternalAgentStatus[] = [];
      for (const backend of wanted) {
        const agentId = backend.declaration.id;
        const checkedAt = new Date().toISOString();
        if (!backend.enabled) {
          agents.push({ agentId, state: 'unavailable', binaryPath: '', reason: 'Agent extension disabled. Enable it before checking the CLI.', checkedAt });
          continue;
        }
        try {
          await verifyExtensionBackendArtifact(backend);
        } catch (error) {
          agents.push({ agentId, state: 'unavailable', binaryPath: '', reason: formatError(error), checkedAt });
          continue;
        }
        // First use detects readiness; subsequent reads share the control client's
        // bounded cache instead of requiring a Settings-only manual check.
        const status = await deps.externalAgents.getStatus(agentId, command.refresh === true);
        agents.push(status);
      }
      return ok(requestId, command.type, { agents, installed: wanted.map((backend) => backend.declaration.id) });
    }
    case 'agents/mcp-status': {
      const installed = await listExtensionBackends(getPiwinRoot(deps.options.piwinRoot));
      if (!installed.some((backend) => backend.declaration.id === command.agentId)) {
        return fail(requestId, command.type, 'unknown-agent');
      }
      return ok(requestId, command.type, {
        agentId: command.agentId,
        ...(deps.externalAgents?.getMcpStatuses({ agentId: command.agentId }) ?? { servers: [], observed: false }),
      });
    }
    case 'agents/sessions-sync': {
      const installed = await listExtensionBackends(getPiwinRoot(deps.options.piwinRoot));
      if (!installed.some((backend) => backend.declaration.id === command.agentId)) {
        return fail(requestId, command.type, `unknown-agent: ${command.agentId}`);
      }
      return syncExternalAgentCatalog(deps, command.agentId, requestId);
    }
    case 'session/backend-get':
    case 'session/backend-set':
      return handleSessionBackendCommand(deps, command, requestId);
    case 'session/rename': {
      const record = await getSessionRecord(indexPathOf(deps), command.sessionId);
      if (record === undefined || !isExternalRecord(record)) {
        return null;
      }
      try {
        await renameExternalSession(deps, record, command.name);
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
      if (record === undefined || !isExternalRecord(record)) {
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
        // The adapter is the source of truth: delete there first. A product-side
        // failure afterwards is repaired by the next catalog sync.
        await deleteExternalSessionEverywhere(deps, record);
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
        if (record !== undefined && isExternalRecord(record) && record.backend !== undefined) {
          try {
            await requireEnabledExtensionBackend(getPiwinRoot(deps.options.piwinRoot), record.backend.agentId);
          } catch (error) {
            return fail(requestId, command.type, formatError(error));
          }
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

/**
 * Commands of the retired per-agent inventory.
 *
 * A session backend now installs as an ordinary piwin extension, so these are
 * answered with guidance instead of acting as a second install path. Reads,
 * readiness checks and session operations keep working through the extension
 * registry above.
 */
const RETIRED_AGENT_INVENTORY_COMMANDS = new Set<HostCommand['type']>([
  'agents/list',
  'agents/install',
  'agents/set-enabled',
  'agents/uninstall',
  'agents/select-runtime',
]);

function retiredAgentInventoryGuidance(
  command: HostCommand,
  requestId: string | undefined,
): HostResponse | null {
  if (!RETIRED_AGENT_INVENTORY_COMMANDS.has(command.type)) return null;
  return fail(
    requestId,
    command.type,
    'agents-inventory-retired: a session backend installs as a piwin extension. ' +
      'Install it from the extension marketplace, then enable it in Settings → Extensions ' +
      '(`extensions/set_enabled`).',
  );
}
