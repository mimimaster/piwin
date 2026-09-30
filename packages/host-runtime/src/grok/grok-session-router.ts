/**
 * Grok routing seams for HostRuntime (ADR 0082).
 *
 * Every function here is called from an existing Host command/lifecycle path
 * with an index record whose `backend.agentId === 'grok'`. Pi sessions never
 * reach this module. Grok handles plug into the same `sessions` map, run
 * registry, transcript recorder and permission map as Pi handles.
 */

import type {
  HostResponse,
  SessionBackendBinding,
  SessionIndexRecord,
} from '@piwin/contracts';
import { formatError, isExternalBackendBinding } from '@piwin/contracts';
import { getSessionRecord, renameSessionRecord, upsertSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import { workingDirectoryFromIndexRecord } from '../session-scope.js';
import { GROK_AGENT_ID, createGrokSessionCapabilities, GROK_UNSUPPORTED_COMMANDS } from './grok-capabilities.js';
import type { GrokSessionHandle } from './grok-session-handle.js';
import { rebuildTranscriptFromReplay } from './grok-transcript-replay.js';
import { requireEnabledAgentPlugin } from './agent-plugin-inventory.js';

export function isGrokRecord(record: SessionIndexRecord | undefined): boolean {
  return record?.backend?.agentId === GROK_AGENT_ID;
}

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
 * Cold activation of a Grok session inside `doActivateSessionRuntime`, after
 * residency admission reserved `runtimeGenerationId`. Opens the process,
 * binds the handle into the Host maps and, when the transcript projection is
 * missing or stale, rebuilds it from `session/load` replay. The caller owns
 * residency commit/abort.
 */
export async function activateGrokSession(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
  runtimeGenerationId: string,
  runId: string | undefined,
  /** User row written for the prompt that triggered activation; kept last. */
  pendingUserMessageId?: string,
): Promise<GrokSessionHandle> {
  const binding = record.backend;
  if (binding === undefined) {
    throw new Error(`grok-binding-missing: ${record.id}`);
  }
  const service = deps.grokBackend;
  if (service === undefined) {
    throw new Error('grok-backend-unavailable: this Host has no Grok backend');
  }
  const plugin = await requireEnabledAgentPlugin(getPiwinRoot(deps.options.piwinRoot));
  if (binding.pluginRevision !== undefined && binding.pluginRevision !== plugin.revision) {
    throw new Error('agent-update-requires-migration: this session uses a different adapter revision');
  }
  const cwd = workingDirectoryFromIndexRecord(record, deps.options.piwinRoot);
  // Replay when the projection has never been synced from Grok (a session
  // imported from the catalog, or a lost projection) or Grok changed it since
  // (e.g. the user continued in the TUI). Sessions created in piwin record
  // `syncedChangeUnixMs` on first bind, so they resume without replay.
  const catalogChange =
    binding.backendSessionId !== undefined
      ? (deps.grokCatalogChanges.get(binding.backendSessionId) ?? 0)
      : 0;
  const replay =
    binding.backendSessionId !== undefined &&
    (binding.syncedChangeUnixMs === undefined || binding.syncedChangeUnixMs < catalogChange);
  const opened = await service.openSession({ productSessionId: record.id, cwd, binding, replay });
  deps.runtimeController.attachGeneration(record.id, runtimeGenerationId, 'external-agent');
  if (runId !== undefined) {
    const attached = deps.runRegistry.attachRuntimeGeneration(runId, runtimeGenerationId);
    if (!attached.ok) {
      await opened.handle.release();
      deps.runtimeController.detachGeneration(record.id);
      throw new Error(`grok generation attach failed: ${attached.reason}`);
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
export async function bindNewGrokSession(
  deps: HostRuntimeKernel,
  sessionId: string,
  input: { modelId?: string; effortId?: string },
): Promise<SessionIndexRecord | undefined> {
  const service = deps.grokBackend;
  if (service === undefined) {
    throw new Error('grok-backend-unavailable: this Host has no Grok backend');
  }
  const plugin = await requireEnabledAgentPlugin(getPiwinRoot(deps.options.piwinRoot));
  await service.requireReadyBinary();
  const record = await getSessionRecord(indexPath(deps), sessionId);
  if (record === undefined) {
    return undefined;
  }
  record.backend = {
    agentId: GROK_AGENT_ID,
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
  const operation = GROK_UNSUPPORTED_COMMANDS.get(command.type);
  if (operation === undefined || typeof command.sessionId !== 'string') {
    return null;
  }
  const record = await getSessionRecord(indexPath(deps), command.sessionId);
  if (!isGrokRecord(record)) {
    return null;
  }
  const support = createGrokSessionCapabilities().operations[operation];
  return fail(
    requestId,
    command.type,
    `backend-operation-unsupported: ${support.supported ? operation : support.reason}`,
    { code: 'backend-operation-unsupported' },
  );
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
  if (!isGrokRecord(record)) {
    return ok(requestId, command.type, { agentId: 'pi' });
  }
  const service = deps.grokBackend;
  if (command.type === 'session/backend-get') {
    return ok(requestId, command.type, {
      agentId: GROK_AGENT_ID,
      capabilities: createGrokSessionCapabilities(),
      ...(service?.getSessionOptions(record.id) !== undefined
        ? { options: service.getSessionOptions(record.id) }
        : {}),
    });
  }
  const fields = [command.modelId, command.effortId, command.modeId].filter((value) => value !== undefined);
  if (fields.length !== 1) {
    return fail(requestId, command.type, 'backend-set requires exactly one of modelId, effortId, modeId');
  }
  const live = deps.sessions.get(record.id) as GrokSessionHandle | undefined;
  try {
    if (live !== undefined && live.backendAgentId === GROK_AGENT_ID) {
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
    agentId: GROK_AGENT_ID,
    ...(live !== undefined ? { options: live.getBackendOptions() } : {}),
  });
}

/** Rename writes through to Grok first so both sides agree. */
export async function renameGrokSession(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
  name: string,
): Promise<void> {
  const backendSessionId = record.backend?.backendSessionId;
  if (backendSessionId !== undefined) {
    await deps.grokBackend?.renameCatalogSession(backendSessionId, name);
  }
  await renameSessionRecord(indexPath(deps), record.id, name);
}

/** Permanent delete: Grok session first, then the product record + projection. */
export async function deleteGrokSessionEverywhere(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
): Promise<void> {
  const backendSessionId = record.backend?.backendSessionId;
  if (backendSessionId !== undefined) {
    await deps.grokBackend?.deleteCatalogSession(backendSessionId);
  }
  deps.grokBackend?.forgetSession(record.id);
}


export { replayEventsToRows } from './grok-transcript-replay.js';
export { applyGrokTitle, syncGrokCatalog } from './grok-catalog-sync.js';
