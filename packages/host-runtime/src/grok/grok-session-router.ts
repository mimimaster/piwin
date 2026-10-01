/**
 * Routing seams for external agent sessions (ADR 0082).
 *
 * Every function here is called from an existing Host command/lifecycle path
 * with an index record whose `backend` is an external binding. Pi sessions
 * never reach this module, and nothing here knows a vendor: the agent id comes
 * from the record, and the adapter is resolved from the installed inventory.
 * Adapter handles plug into the same `sessions` map, run registry, transcript
 * recorder and permission map as Pi handles.
 */

import type {
  AgentPluginMigrationConfirmation,
  HostResponse,
  SessionBackendBinding,
  SessionIndexRecord,
} from '@piwin/contracts';
import { assessAgentPluginBinding, formatError, isExternalBackendBinding, type AgentPluginBindingTarget } from '@piwin/contracts';
import { getSessionRecord, renameSessionRecord, upsertSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import { workingDirectoryFromIndexRecord } from '../session-scope.js';
import { externalOperationRefusal } from '../external-agent-policy.js';
import type { AgentPluginSession } from '../agent-plugin-session.js';
import { rebuildTranscriptFromReplay } from './grok-transcript-replay.js';
import { listExtensionBackends, requireExtensionBackendLaunch, type ExtensionBackend } from '../extension-session-backends.js';

export function isExternalRecord(record: SessionIndexRecord | undefined): boolean {
  return isExternalBackendBinding(record?.backend);
}

function indexPath(deps: HostRuntimeKernel): string {
  return getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
}

async function persistBinding(
  deps: HostRuntimeKernel,
  sessionId: string,
  patch: Partial<SessionBackendBinding>,
): Promise<SessionIndexRecord | undefined> {
  const record = await getSessionRecord(indexPath(deps), sessionId);
  if (record?.backend === undefined) {
    return undefined;
  }
  record.backend = { ...record.backend, ...patch };
  await upsertSessionRecord(indexPath(deps), record);
  return record;
}

/**
 * Cold activation of an external session inside `doActivateSessionRuntime`,
 * after residency admission reserved `runtimeGenerationId`. Opens the adapter,
 * binds the handle into the Host maps and, when the transcript projection is
 * missing or stale, rebuilds it from `session/load` replay. The caller owns
 * residency commit/abort.
 */
export async function activateExternalSession(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
  runtimeGenerationId: string,
  runId: string | undefined,
  /** User row written for the prompt that triggered activation; kept last. */
  pendingUserMessageId?: string,
): Promise<AgentPluginSession> {
  const binding = record.backend;
  if (binding === undefined) {
    throw new Error(`agent-binding-missing: ${record.id}`);
  }
  const backend = deps.externalAgents;
  if (backend === undefined) {
    throw new Error('external-agent-backend-unavailable: this Host has no agent adapter backend');
  }
  const plugin = await requireExtensionBackendLaunch(getPiwinRoot(deps.options.piwinRoot), binding.agentId);
  if (binding.pluginRevision !== undefined && binding.pluginRevision !== plugin.revision) {
    throw new Error('agent-update-requires-migration: this session uses a different adapter revision');
  }
  const cwd = workingDirectoryFromIndexRecord(record, deps.options.piwinRoot);
  // Replay when the projection has never been synced from the agent (a session
  // imported from the catalog, or a lost projection) or the agent changed it
  // since (e.g. the user continued in its own TUI). Sessions created in piwin
  // record `syncedChangeUnixMs` on first bind, so they resume without replay.
  const catalogChange =
    binding.backendSessionId !== undefined
      ? (deps.externalCatalogChanges.get(binding.backendSessionId) ?? 0)
      : 0;
  const replay =
    binding.backendSessionId !== undefined &&
    (binding.syncedChangeUnixMs === undefined || binding.syncedChangeUnixMs < catalogChange);
  const mode = binding.backendSessionId === undefined ? 'new' : replay ? 'load' : 'resume';
  const opened = await backend.openSession({
    agentId: binding.agentId,
    productSessionId: record.id,
    cwd,
    binding,
    mode,
    runtimeGenerationId,
    ...(runId !== undefined ? { runId } : {}),
  });
  deps.runtimeController.attachGeneration(record.id, runtimeGenerationId, 'external-agent');
  if (runId !== undefined) {
    const attached = deps.runRegistry.attachRuntimeGeneration(runId, runtimeGenerationId);
    if (!attached.ok) {
      await opened.handle.release();
      deps.runtimeController.detachGeneration(record.id);
      throw new Error(`agent generation attach failed: ${attached.reason}`);
    }
  }
  const bindingPatch: Partial<SessionBackendBinding> = {
    backendSessionId: opened.backendSessionId,
    pluginRevision: plugin.revision,
    ...(opened.agentVersion !== undefined ? { agentVersion: opened.agentVersion } : {}),
  };
  if (binding.syncedChangeUnixMs === undefined && !replay) {
    // New piwin-created session: the projection is authoritative from here.
    bindingPatch.syncedChangeUnixMs = Date.now();
  }
  try {
    if (replay) {
      await rebuildTranscriptFromReplay(deps, record, opened.replayEvents, pendingUserMessageId);
      bindingPatch.syncedChangeUnixMs = Date.now();
    }
    await persistBinding(deps, record.id, bindingPatch);
    deps.host.registerExternalSession(record.id, opened.handle);
    await deps.bindSession(opened.handle, record.projectPath, record.name, undefined, runtimeGenerationId);
  } catch (error) {
    await deps.host.dropSession(record.id).catch(() => undefined);
    await opened.handle.release().catch(() => undefined);
    deps.runtimeController.detachGeneration(record.id);
    deps.sessions.delete(record.id);
    throw error;
  }
  return opened.handle;
}

/** Persist the backend binding on a freshly created product session. */
export async function bindNewExternalSession(
  deps: HostRuntimeKernel,
  sessionId: string,
  agentId: string,
  input: { modelId?: string; effortId?: string },
): Promise<SessionIndexRecord | undefined> {
  const backend = deps.externalAgents;
  if (backend === undefined) {
    throw new Error('external-agent-backend-unavailable: this Host has no agent adapter backend');
  }
  const plugin = await requireExtensionBackendLaunch(getPiwinRoot(deps.options.piwinRoot), agentId);
  await backend.requireReadyBinary(agentId);
  const record = await getSessionRecord(indexPath(deps), sessionId);
  if (record === undefined) {
    return undefined;
  }
  record.backend = {
    agentId,
    pluginRevision: plugin.revision,
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    ...(input.effortId !== undefined ? { effortId: input.effortId } : {}),
  };
  await upsertSessionRecord(indexPath(deps), record);
  return record;
}

/** Refuse Pi-only commands for external sessions (ADR 0082 §3). */
export async function rejectUnsupportedExternalCommand(
  deps: HostRuntimeKernel,
  command: { type: string; sessionId?: unknown },
  requestId: string | undefined,
): Promise<HostResponse | null> {
  if (!externalAgentSupportsCommand(command.type) || typeof command.sessionId !== 'string') {
    return null;
  }
  const record = await getSessionRecord(indexPath(deps), command.sessionId);
  if (!isExternalRecord(record) || record?.backend === undefined) {
    return null;
  }
  const refusal = externalOperationRefusal(
    command.type,
    deps.externalAgents?.getSessionCapabilities(record.id),
  );
  if (refusal === undefined) {
    return null;
  }
  return fail(
    requestId,
    command.type,
    `backend-operation-unsupported: ${refusal.reason}`,
    { code: 'backend-operation-unsupported' },
  );
}

function externalAgentSupportsCommand(commandType: string): boolean {
  return externalOperationRefusal(commandType, undefined) !== undefined;
}

/** `session/backend-get` / `session/backend-set`. */
export async function handleSessionBackendCommand(
  deps: HostRuntimeKernel,
  command:
    | { type: 'session/backend-get'; sessionId: string }
    | { type: 'session/backend-set'; sessionId: string; modelId?: string; effortId?: string; modeId?: string },
  requestId: string | undefined,
): Promise<HostResponse> {
  const record = await getSessionRecord(indexPath(deps), command.sessionId);
  if (record === undefined) {
    return fail(requestId, command.type, `Unknown session: ${command.sessionId}`);
  }
  if (!isExternalRecord(record) || record.backend === undefined) {
    return ok(requestId, command.type, { agentId: 'pi' });
  }
  const agentId = record.backend.agentId;
  const service = deps.externalAgents;
  if (command.type === 'session/backend-get') {
    const capabilities = service?.getSessionCapabilities(record.id);
    const options = service?.getSessionOptions(record.id);
    const installed = await findExtensionBackend(deps, agentId);
    const bindingReadiness = installed === undefined ? undefined : assessAgentPluginBinding(record.backend, bindingTargetOf(installed));
    // ADR 0082: capabilities are the adapter's own declaration from
    // `session/new`; before first activation the Host has nothing to report.
    return ok(requestId, command.type, {
      agentId,
      ...(capabilities !== undefined ? { capabilities } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(bindingReadiness !== undefined ? { bindingReadiness } : {}),
    });
  }
  const fields = [command.modelId, command.effortId, command.modeId].filter((value) => value !== undefined);
  if (fields.length !== 1) {
    return fail(requestId, command.type, 'backend-set requires exactly one of modelId, effortId, modeId');
  }
  const live = deps.sessions.get(record.id) as AgentPluginSession | undefined;
  try {
    if (live !== undefined && live.backendAgentId === agentId) {
      if (command.modelId !== undefined) await live.setModel(command.modelId);
      if (command.effortId !== undefined) await live.setEffort(command.effortId);
      if (command.modeId !== undefined) await live.setMode(command.modeId);
    }
    // Persist so the next resume re-applies the choice.
    await persistBinding(deps, record.id, {
      ...(command.modelId !== undefined ? { modelId: command.modelId } : {}),
      ...(command.effortId !== undefined ? { effortId: command.effortId } : {}),
      ...(command.modeId !== undefined ? { modeId: command.modeId } : {}),
    });
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
  return ok(requestId, command.type, {
    agentId,
    ...(live !== undefined ? { options: live.getBackendOptions() } : {}),
  });
}

/**
 * Move one session onto the installed adapter revision. Identity, native
 * session id, cwd and history stay put. Incompatible or stale confirmations fail.
 */
export async function confirmExternalBindingMigration(
  deps: HostRuntimeKernel,
  confirmation: AgentPluginMigrationConfirmation,
  requestId: string | undefined,
): Promise<HostResponse> {
  const record = await getSessionRecord(indexPath(deps), confirmation.sessionId);
  if (record?.backend === undefined || !isExternalRecord(record)) {
    return fail(requestId, 'agents/confirm-binding-migration', `Unknown session: ${confirmation.sessionId}`);
  }
  const installed = await findExtensionBackend(deps, record.backend.agentId);
  if (installed === undefined) {
    return fail(requestId, 'agents/confirm-binding-migration', 'agent-plugin-not-installed');
  }
  const assessment = assessAgentPluginBinding(record.backend, bindingTargetOf(installed));
  if (assessment.state !== 'migration-required') {
    return fail(requestId, 'agents/confirm-binding-migration', 'agent-migration-not-required');
  }
  if (!assessment.compatible) {
    return fail(requestId, 'agents/confirm-binding-migration', 'agent-migration-incompatible');
  }
  if (confirmation.expectedRevision !== assessment.expectedRevision || confirmation.targetRevision !== assessment.targetRevision) {
    return fail(requestId, 'agents/confirm-binding-migration', 'agent-migration-stale');
  }
  await persistBinding(deps, record.id, { pluginRevision: confirmation.targetRevision });
  return ok(requestId, 'agents/confirm-binding-migration', {
    sessionId: record.id,
    agentId: record.backend.agentId,
    backendSessionId: record.backend.backendSessionId,
    pluginRevision: confirmation.targetRevision,
  });
}

/** Rename writes through to the agent catalog first so both sides agree. */
export async function renameExternalSession(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
  name: string,
): Promise<void> {
  const binding = record.backend;
  if (binding?.backendSessionId !== undefined) {
    await deps.externalAgents?.renameCatalogSession(binding.agentId, binding.backendSessionId, name);
  }
  await renameSessionRecord(indexPath(deps), record.id, name);
}

/** Permanent delete: the agent session first, then the product record + projection. */
export async function deleteExternalSessionEverywhere(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
): Promise<void> {
  const binding = record.backend;
  if (binding?.backendSessionId !== undefined) {
    await deps.externalAgents?.deleteCatalogSession(binding.agentId, binding.backendSessionId);
  }
  deps.externalAgents?.forgetSession(record.id);
}

export { replayEventsToRows } from './grok-transcript-replay.js';
export { applyExternalAgentTitle, syncExternalAgentCatalog } from './grok-catalog-sync.js';

/** Installed backend for an agent id, enabled or not; undefined when absent. */
async function findExtensionBackend(
  deps: HostRuntimeKernel,
  agentId: string,
): Promise<ExtensionBackend | undefined> {
  const backends = await listExtensionBackends(getPiwinRoot(deps.options.piwinRoot));
  return backends.find((backend) => backend.declaration.id === agentId);
}

/**
 * Project an enabled extension revision onto the binding-assessment target.
 *
 * `revision` is the extension `contentRevision`, which is what a binding's
 * `pluginRevision` now stores; a binding written by the retired inventory will
 * mismatch and surface as `migration-required` rather than silently continuing.
 */
function bindingTargetOf(backend: ExtensionBackend): AgentPluginBindingTarget {
  return {
    agentId: backend.declaration.id,
    revision: backend.contentRevision,
    enabled: backend.enabled,
    unversionedBindingCompatible: backend.declaration.unversionedBindingCompatible,
    compatibleRevisions: backend.declaration.compatibleRevisions,
  };
}
